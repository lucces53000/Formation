import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

export const CATALOG_COLLECTIONS = [
  "trainings",
  "trainingCategories",
  "trainingLocations",
  "trainingContacts",
  "importantInformation",
  "importantInformationCategories"
];

const BATCH_SIZE = 400;
const MAX_ATOMIC_PUBLICATION_WRITES = 450;
const REVIEW_LINK_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
const PUBLICATION_LOCK_LIFETIME_MS = 5 * 60 * 1000;

function isTimestamp(value) {
  return value instanceof Timestamp ||
    (value && typeof value === "object" &&
      Number.isInteger(value.seconds) && Number.isInteger(value.nanoseconds) &&
      typeof value.toDate === "function");
}

function normalizeValue(value) {
  if (isTimestamp(value)) {
    return { type: "timestamp", seconds: value.seconds, nanoseconds: value.nanoseconds };
  }
  if (value instanceof Date) {
    const timestamp = Timestamp.fromDate(value);
    return { type: "timestamp", seconds: timestamp.seconds, nanoseconds: timestamp.nanoseconds };
  }
  if (value instanceof Uint8Array) {
    return { type: "bytes", value: Array.from(value) };
  }
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value && typeof value === "object" && typeof value.path === "string" && value.firestore) {
    return { type: "reference", path: value.path };
  }
  if (value && typeof value === "object" && Number.isFinite(value.latitude) && Number.isFinite(value.longitude)) {
    return { type: "geoPoint", latitude: value.latitude, longitude: value.longitude };
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalizeValue(value[key])]));
  }
  if (typeof value === "number" && !Number.isFinite(value)) return { type: "number", value: String(value) };
  return value;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function hashRecords(recordsByCollection) {
  const bytes = new TextEncoder().encode(stableStringify(normalizeValue(recordsByCollection)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function createReviewCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function recordsCollection(parent, collectionName) {
  return collection(parent, "records", collectionName, "items");
}

async function readCollectionRecords(collectionRef) {
  const snapshot = await getDocs(collectionRef);
  return snapshot.docs.map((item) => ({ id: item.id, data: item.data() }));
}

async function readActiveCatalog(db) {
  const results = await Promise.all(CATALOG_COLLECTIONS.map(async (name) => [
    name,
    await readCollectionRecords(collection(db, name))
  ]));
  return Object.fromEntries(results);
}

async function readVersionCatalog(db, versionId) {
  const parent = doc(db, "catalogVersions", versionId);
  const results = await Promise.all(CATALOG_COLLECTIONS.map(async (name) => [
    name,
    await readCollectionRecords(recordsCollection(parent, name))
  ]));
  return Object.fromEntries(results);
}

async function readArchiveCatalog(db, archiveId) {
  const parent = doc(db, "catalogArchives", archiveId);
  const results = await Promise.all(CATALOG_COLLECTIONS.map(async (name) => [
    name,
    await readCollectionRecords(recordsCollection(parent, name))
  ]));
  return Object.fromEntries(results);
}

async function writeRecordSnapshots(db, parent, recordsByCollection) {
  const operations = [];
  CATALOG_COLLECTIONS.forEach((name) => {
    (recordsByCollection[name] || []).forEach((record) => {
      operations.push({ ref: doc(recordsCollection(parent, name), record.id), data: record.data });
    });
  });
  for (let offset = 0; offset < operations.length; offset += BATCH_SIZE) {
    const batch = writeBatch(db);
    operations.slice(offset, offset + BATCH_SIZE).forEach(({ ref, data }) => batch.set(ref, data));
    await batch.commit();
  }
}

async function synchronizeReviewSnapshot(db, reviewLinkRef, recordsByCollection) {
  const operations = [];
  for (const name of CATALOG_COLLECTIONS) {
    const targetRef = recordsCollection(reviewLinkRef, name);
    const [existing, next] = await Promise.all([
      getDocs(targetRef),
      new Map((recordsByCollection[name] || []).map((record) => [record.id, record.data]))
    ]);
    existing.docs.forEach((item) => {
      if (!next.has(item.id)) operations.push({ ref: item.ref, deleted: true });
    });
    next.forEach((data, id) => {
      operations.push({ ref: doc(targetRef, id), data });
    });
  }
  for (let offset = 0; offset < operations.length; offset += BATCH_SIZE) {
    const batch = writeBatch(db);
    operations.slice(offset, offset + BATCH_SIZE).forEach((operation) => {
      if (operation.deleted) batch.delete(operation.ref);
      else batch.set(operation.ref, operation.data);
    });
    await batch.commit();
  }
}

async function readCatalogInTransaction(transaction, db, recordsByCollection) {
  const reads = CATALOG_COLLECTIONS.flatMap((name) =>
    (recordsByCollection[name] || []).map((record) => ({
      name,
      reference: doc(db, name, record.id)
    }))
  );
  const snapshots = await Promise.all(reads.map(({ reference }) => transaction.get(reference)));
  const records = Object.fromEntries(CATALOG_COLLECTIONS.map((name) => [name, []]));
  snapshots.forEach((snapshot, index) => {
    if (snapshot.exists()) {
      records[reads[index].name].push({ id: snapshot.id, data: snapshot.data() });
    }
  });
  return records;
}

async function acquireCatalogPublicationLock(db, expectedActiveVersionId) {
  const pointerRef = doc(db, "siteSettings", "catalogue");
  const token = createReviewCode();
  await runTransaction(db, async (transaction) => {
    const pointer = await transaction.get(pointerRef);
    const current = pointer.exists() ? pointer.data() : {};
    if ((current.activeVersionId || "") !== expectedActiveVersionId) {
      throw new Error("Le catalogue actif a changé. Actualisez la page et recommencez.");
    }
    if (
      current.publicationLockToken &&
      current.publicationLockExpiresAt instanceof Timestamp &&
      current.publicationLockExpiresAt.toMillis() > Date.now()
    ) {
      throw new Error("Une publication ou une restauration est déjà en cours. Réessayez dans quelques minutes.");
    }
    transaction.set(pointerRef, {
      ...current,
      activeVersionId: current.activeVersionId || "",
      publicationLockToken: token,
      publicationLockExpiresAt: Timestamp.fromDate(new Date(Date.now() + PUBLICATION_LOCK_LIFETIME_MS)),
      updatedAt: serverTimestamp()
    });
  });
  return { pointerRef, token };
}

async function releaseCatalogPublicationLock(db, lock) {
  await runTransaction(db, async (transaction) => {
    const pointer = await transaction.get(lock.pointerRef);
    if (!pointer.exists() || pointer.data().publicationLockToken !== lock.token) return;
    transaction.update(lock.pointerRef, {
      publicationLockToken: deleteField(),
      publicationLockExpiresAt: deleteField(),
      updatedAt: serverTimestamp()
    });
  });
}

function throwAfterReleasingLock(db, lock, error) {
  return releaseCatalogPublicationLock(db, lock)
    .catch((releaseError) => {
      throw new Error(`${error.message} Le verrou temporaire n’a pas pu être libéré : ${releaseError.message}`);
    })
    .then(() => { throw error; });
}

function mergeRollbackCollection(archivedRecords, publishedRecords, currentRecords) {
  const archived = new Map(archivedRecords.map((record) => [record.id, record]));
  const published = new Map(publishedRecords.map((record) => [record.id, record.data]));
  const current = new Map(currentRecords.map((record) => [record.id, record]));
  const ids = new Set([...archived.keys(), ...published.keys(), ...current.keys()]);
  const mutations = [];
  ids.forEach((id) => {
    const oldPublished = published.has(id) ? normalizeValue(published.get(id)) : undefined;
    const currentValue = current.has(id) ? normalizeValue(current.get(id).data) : undefined;
    if (stableStringify(currentValue) !== stableStringify(oldPublished)) return;
    if (archived.has(id)) mutations.push({ id, data: archived.get(id).data });
    else if (current.has(id)) mutations.push({ id, deleted: true });
  });
  return mutations;
}

export async function createCatalogReviewVersion(db, { year, title, createdBy }) {
  if (!Number.isInteger(year) || year < 2000 || year > 2200) throw new Error("L’année de la version est invalide.");
  const normalizedTitle = String(title || "").trim();
  if (!normalizedTitle || normalizedTitle.length > 100) throw new Error("Le nom de la version est obligatoire (100 caractères maximum).");

  const [records, verificationRecords] = await Promise.all([readActiveCatalog(db), readActiveCatalog(db)]);
  const baseHash = await hashRecords(records);
  if (baseHash !== await hashRecords(verificationRecords)) {
    throw new Error("Le catalogue a changé pendant la copie. Actualisez les données puis recommencez.");
  }

  const versionRef = doc(collection(db, "catalogVersions"));
  const code = createReviewCode();
  const reviewLinkRef = doc(db, "catalogReviewLinks", code);
  const expiresAt = Timestamp.fromDate(new Date(Date.now() + REVIEW_LINK_LIFETIME_MS));
  const initialBatch = writeBatch(db);
  initialBatch.set(versionRef, {
    year,
    title: normalizedTitle,
    status: "creating",
    createdBy,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    baseHash,
    reviewLinkId: code,
    lastReviewDecision: null,
    lastReviewComment: ""
  });
  initialBatch.set(reviewLinkRef, {
    versionId: versionRef.id,
    year,
    title: normalizedTitle,
    status: "creating",
    expiresAt,
    createdAt: serverTimestamp(),
    lastReviewDecision: null,
    lastReviewComment: ""
  });
  await initialBatch.commit();
  try {
    await writeRecordSnapshots(db, versionRef, records);
    await updateDoc(versionRef, { status: "draft", updatedAt: serverTimestamp() });
    await updateDoc(reviewLinkRef, { status: "draft" });
    return { id: versionRef.id, year, title: normalizedTitle, code, status: "draft" };
  } catch (error) {
    await Promise.all([
      updateDoc(versionRef, { status: "incomplete", updatedAt: serverTimestamp() }),
      updateDoc(reviewLinkRef, { status: "incomplete" })
    ]);
    throw new Error(`La copie n’a pas pu être créée complètement : ${error.message}`);
  }
}

export async function loadCatalogReviewByCode(db, code) {
  const linkRef = doc(db, "catalogReviewLinks", code);
  const linkSnapshot = await getDoc(linkRef);
  if (!linkSnapshot.exists()) throw new Error("Ce lien de relecture est invalide ou a été révoqué.");
  const version = linkSnapshot.data();
  if (
    version.status !== "in_review" ||
    !(version.expiresAt instanceof Timestamp) ||
    version.expiresAt.toMillis() <= Date.now()
  ) {
    throw new Error("Ce lien de relecture est expiré, révoqué ou n’est plus actif.");
  }
  const records = {};
  await Promise.all(CATALOG_COLLECTIONS.map(async (name) => {
    records[name] = await readCollectionRecords(recordsCollection(linkRef, name));
  }));
  return {
    version: { id: version.versionId, title: version.title, year: version.year, status: version.status },
    records
  };
}

export async function submitCatalogReviewDecision(db, { code, decision, comment }) {
  if (!["approved", "corrections_requested"].includes(decision)) throw new Error("La décision de relecture est invalide.");
  const normalizedComment = String(comment || "").trim();
  if (decision === "corrections_requested" && !normalizedComment) throw new Error("Un commentaire est obligatoire pour demander des corrections.");
  if (normalizedComment.length > 2000) throw new Error("Le commentaire est limité à 2 000 caractères.");
  const linkRef = doc(db, "catalogReviewLinks", code);
  const snapshot = await getDoc(linkRef);
  if (!snapshot.exists()) throw new Error("Ce lien de relecture est invalide ou a été révoqué.");
  const link = snapshot.data();
  if (link.status !== "in_review" || !(link.expiresAt instanceof Timestamp) || link.expiresAt.toMillis() <= Date.now()) {
    throw new Error("Ce lien de relecture n’est plus actif.");
  }
  const versionRef = doc(db, "catalogVersions", link.versionId);
  const reviewedAt = serverTimestamp();
  const batch = writeBatch(db);
  batch.update(linkRef, {
    status: decision,
    lastReviewDecision: decision,
    lastReviewComment: normalizedComment,
    reviewedAt,
    updatedAt: reviewedAt
  });
  batch.update(versionRef, {
    status: decision,
    lastReviewDecision: decision,
    lastReviewComment: normalizedComment,
    reviewedAt,
    updatedAt: reviewedAt
  });
  await batch.commit();
}

export async function submitCatalogReviewVersion(db, versionId) {
  const versionRef = doc(db, "catalogVersions", versionId);
  const versionSnapshot = await getDoc(versionRef);
  if (!versionSnapshot.exists()) throw new Error("Cette version n’existe plus.");
  const version = versionSnapshot.data();
  if (!["draft", "corrections_requested"].includes(version.status)) {
    throw new Error("Seule une version en brouillon ou à corriger peut être soumise.");
  }
  const linkRef = doc(db, "catalogReviewLinks", version.reviewLinkId);
  const linkSnapshot = await getDoc(linkRef);
  if (!linkSnapshot.exists() || linkSnapshot.data().status === "revoked") {
    throw new Error("Le lien de relecture est indisponible. Remplacez-le avant la soumission.");
  }
  const records = await readVersionCatalog(db, versionId);
  await synchronizeReviewSnapshot(db, linkRef, records);
  await runTransaction(db, async (transaction) => {
    const [currentVersion, currentLink] = await Promise.all([
      transaction.get(versionRef),
      transaction.get(linkRef)
    ]);
    if (!currentVersion.exists() || !["draft", "corrections_requested"].includes(currentVersion.data().status)) {
      throw new Error("L’état de la version a changé. Actualisez avant de soumettre.");
    }
    if (!currentLink.exists() || currentLink.data().versionId !== versionId) {
      throw new Error("Le lien de relecture ne correspond plus à cette version.");
    }
    const expiresAt = Timestamp.fromDate(new Date(Date.now() + REVIEW_LINK_LIFETIME_MS));
    transaction.update(versionRef, {
      status: "in_review",
      submittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastReviewDecision: null
    });
    transaction.update(linkRef, {
      status: "in_review",
      expiresAt,
      submittedAt: serverTimestamp(),
      lastReviewDecision: null,
      lastReviewComment: ""
    });
  });
}

export async function rotateCatalogReviewLink(db, versionId) {
  const versionRef = doc(db, "catalogVersions", versionId);
  const versionSnapshot = await getDoc(versionRef);
  if (!versionSnapshot.exists() || versionSnapshot.data().status !== "in_review") {
    throw new Error("Seule une version en relecture peut recevoir un nouveau lien.");
  }
  const version = versionSnapshot.data();
  const oldLinkRef = doc(db, "catalogReviewLinks", version.reviewLinkId);
  const code = createReviewCode();
  const newLinkRef = doc(db, "catalogReviewLinks", code);
  const records = await readVersionCatalog(db, versionId);
  await setDoc(newLinkRef, {
    versionId,
    year: version.year,
    title: version.title,
    status: "creating",
    expiresAt: Timestamp.fromDate(new Date(Date.now() + REVIEW_LINK_LIFETIME_MS)),
    createdAt: serverTimestamp(),
    lastReviewDecision: null,
    lastReviewComment: ""
  });
  await writeRecordSnapshots(db, newLinkRef, records);
  await runTransaction(db, async (transaction) => {
    const [currentVersion, oldLink] = await Promise.all([
      transaction.get(versionRef),
      transaction.get(oldLinkRef)
    ]);
    if (!currentVersion.exists() || currentVersion.data().status !== "in_review" ||
      currentVersion.data().reviewLinkId !== version.reviewLinkId ||
      !oldLink.exists() || oldLink.data().status !== "in_review") {
      throw new Error("L’état de la relecture a changé. Actualisez la page et recommencez.");
    }
    transaction.update(oldLinkRef, { status: "revoked", updatedAt: serverTimestamp() });
    transaction.update(newLinkRef, { status: "in_review" });
    transaction.update(versionRef, { reviewLinkId: code, updatedAt: serverTimestamp() });
  });
  return { code };
}

async function archiveCatalog(db, archiveRef, records, metadata) {
  await setDoc(archiveRef, { ...metadata, status: "preparing", createdAt: serverTimestamp() });
  try {
    await writeRecordSnapshots(db, archiveRef, records);
    return true;
  } catch (error) {
    await updateDoc(archiveRef, { status: "incomplete" });
    throw error;
  }
}

export async function publishCatalogReviewVersion(db, versionId, publishedBy) {
  const versionRef = doc(db, "catalogVersions", versionId);
  const versionSnapshot = await getDoc(versionRef);
  if (!versionSnapshot.exists() || versionSnapshot.data().status !== "approved") {
    throw new Error("La version doit être approuvée avant publication.");
  }
  const version = versionSnapshot.data();
  const reviewLinkRef = doc(db, "catalogReviewLinks", version.reviewLinkId);
  const reviewLinkSnapshot = await getDoc(reviewLinkRef);
  if (!reviewLinkSnapshot.exists() || reviewLinkSnapshot.data().status !== "approved") {
    throw new Error("Le lien de relecture n’enregistre pas une approbation.");
  }
  const [newRecords, initialActiveRecords, pointerSnapshot] = await Promise.all([
    readVersionCatalog(db, versionId),
    readActiveCatalog(db),
    getDoc(doc(db, "siteSettings", "catalogue"))
  ]);
  if (await hashRecords(initialActiveRecords) !== version.baseHash) {
    throw new Error("Le catalogue actif a changé depuis la création de cette copie. Créez une nouvelle version pour ne pas écraser des modifications.");
  }
  const archiveId = `before-${versionId}`;
  const archiveRef = doc(db, "catalogArchives", archiveId);
  const previousVersionId = pointerSnapshot.exists() ? pointerSnapshot.data().activeVersionId || "" : "";
  await archiveCatalog(db, archiveRef, initialActiveRecords, {
    sourceVersionId: previousVersionId,
    beforePublishingVersionId: versionId,
    createdBy: publishedBy
  });

  const lock = await acquireCatalogPublicationLock(db, previousVersionId);
  try {
    const lockedActiveRecords = await readActiveCatalog(db);
    if (await hashRecords(lockedActiveRecords) !== version.baseHash) {
      throw new Error("Le catalogue actif a changé pendant la préparation de la publication. Aucune donnée publique n’a été modifiée.");
    }

    await runTransaction(db, async (transaction) => {
      const [currentVersion, currentLink, currentArchive, currentPointer, activeRecords] = await Promise.all([
        transaction.get(versionRef),
        transaction.get(reviewLinkRef),
        transaction.get(archiveRef),
        transaction.get(lock.pointerRef),
        readCatalogInTransaction(transaction, db, lockedActiveRecords)
      ]);
      if (!currentVersion.exists() || currentVersion.data().status !== "approved" ||
        !currentLink.exists() || currentLink.data().status !== "approved" ||
        !currentArchive.exists() || currentArchive.data().status !== "preparing" ||
        !currentPointer.exists() ||
        currentPointer.data().activeVersionId !== previousVersionId ||
        currentPointer.data().publicationLockToken !== lock.token ||
        !(currentPointer.data().publicationLockExpiresAt instanceof Timestamp) ||
        currentPointer.data().publicationLockExpiresAt.toMillis() <= Date.now()) {
        throw new Error("L’approbation, l’archive ou le verrou temporaire a changé. Actualisez et recommencez.");
      }
      if (await hashRecords(activeRecords) !== version.baseHash) {
        throw new Error("Le catalogue actif a changé pendant la préparation de la publication. Aucune donnée publique n’a été modifiée.");
      }
      const mutations = [];
      CATALOG_COLLECTIONS.forEach((name) => {
        const current = new Map(activeRecords[name].map((record) => [record.id, record.data]));
        const next = new Map(newRecords[name].map((record) => [record.id, record.data]));
        current.forEach((data, id) => {
          if (!next.has(id)) mutations.push({ name, id, deleted: true });
        });
        next.forEach((data, id) => {
          if (!current.has(id) ||
            stableStringify(normalizeValue(current.get(id))) !== stableStringify(normalizeValue(data))) {
            mutations.push({ name, id, data });
          }
        });
      });
      if (mutations.length > MAX_ATOMIC_PUBLICATION_WRITES - 6) {
        throw new Error("La publication dépasse la limite d’une bascule atomique sûre. Aucune donnée publique n’a été modifiée.");
      }
      mutations.forEach((mutation) => {
        const reference = doc(db, mutation.name, mutation.id);
        if (mutation.deleted) transaction.delete(reference);
        else transaction.set(reference, mutation.data);
      });
      if (previousVersionId && previousVersionId !== versionId) {
        transaction.update(doc(db, "catalogVersions", previousVersionId), {
          status: "archived",
          archivedAt: serverTimestamp()
        });
      }
      transaction.update(archiveRef, { status: "archived", archivedAt: serverTimestamp() });
      transaction.update(reviewLinkRef, { status: "published", publishedAt: serverTimestamp() });
      transaction.update(versionRef, {
        status: "published",
        publishedBy,
        publishedAt: serverTimestamp(),
        archivedAt: null,
        reviewLinkId: version.reviewLinkId,
        archiveId
      });
      transaction.set(lock.pointerRef, {
        activeVersionId: versionId,
        archiveId,
        updatedAt: serverTimestamp()
      });
    });
  } catch (error) {
    await throwAfterReleasingLock(db, lock, error);
  }
  return { published: true, archiveId };
}

export async function listCatalogReviewData(db) {
  const [versionSnapshot, archiveSnapshot] = await Promise.all([
    getDocs(collection(db, "catalogVersions")),
    getDocs(collection(db, "catalogArchives"))
  ]);
  const versions = versionSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  const archives = archiveSnapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter((item) => item.status === "archived");
  return { versions, archives };
}

export async function deleteCatalogReviewVersion(db, versionId) {
  const versionRef = doc(db, "catalogVersions", versionId);
  let reviewLinkId = "";
  await runTransaction(db, async (transaction) => {
    const versionSnapshot = await transaction.get(versionRef);
    if (!versionSnapshot.exists()) throw new Error("Cette version n’existe plus.");
    const version = versionSnapshot.data();
    const deletableStatuses = [
      "draft",
      "in_review",
      "corrections_requested",
      "approved",
      "incomplete",
      "deleting"
    ];
    if (!deletableStatuses.includes(version.status)) {
      throw new Error("Seule une version qui n’a pas été publiée peut être supprimée.");
    }

    reviewLinkId = typeof version.reviewLinkId === "string" ? version.reviewLinkId : "";
    const reviewLinkRef = reviewLinkId ? doc(db, "catalogReviewLinks", reviewLinkId) : null;
    const reviewLinkSnapshot = reviewLinkRef ? await transaction.get(reviewLinkRef) : null;
    if (reviewLinkSnapshot?.exists()) {
      const reviewLink = reviewLinkSnapshot.data();
      if (reviewLink.versionId !== versionId || reviewLink.status === "published") {
        throw new Error("Le lien de relecture ne correspond pas à cette version ou a déjà été publié.");
      }
      if (reviewLink.status !== "deleting") {
        transaction.update(reviewLinkRef, { status: "deleting", updatedAt: serverTimestamp() });
      }
    }
    if (version.status !== "deleting") {
      transaction.update(versionRef, { status: "deleting", updatedAt: serverTimestamp() });
    }
  });

  const parents = [versionRef];
  if (reviewLinkId) parents.push(doc(db, "catalogReviewLinks", reviewLinkId));
  for (const parent of parents) {
    for (const collectionName of CATALOG_COLLECTIONS) {
      const records = await getDocs(recordsCollection(parent, collectionName));
      for (let offset = 0; offset < records.docs.length; offset += BATCH_SIZE) {
        const batch = writeBatch(db);
        records.docs.slice(offset, offset + BATCH_SIZE).forEach((record) => batch.delete(record.ref));
        await batch.commit();
      }
    }
  }

  const deleteBatch = writeBatch(db);
  if (reviewLinkId) deleteBatch.delete(doc(db, "catalogReviewLinks", reviewLinkId));
  deleteBatch.delete(versionRef);
  await deleteBatch.commit();
}

export async function restoreCatalogArchive(db, archiveId, restoredBy) {
  const archiveRef = doc(db, "catalogArchives", archiveId);
  const archiveSnapshot = await getDoc(archiveRef);
  if (!archiveSnapshot.exists() || archiveSnapshot.data().status !== "archived") {
    throw new Error("Cette archive n’est pas disponible.");
  }
  const metadata = archiveSnapshot.data();
  const publishedVersionId = metadata.beforePublishingVersionId;
  if (!publishedVersionId) throw new Error("Cette archive ne possède pas de référence de version active pour un retour arrière sûr.");
  const versionRef = doc(db, "catalogVersions", publishedVersionId);
  const [archivedRecords, publishedRecords] = await Promise.all([
    readArchiveCatalog(db, archiveId),
    readVersionCatalog(db, publishedVersionId)
  ]);
  const pointerRef = doc(db, "siteSettings", "catalogue");
  const pointer = await getDoc(pointerRef);
  if (!pointer.exists() || pointer.data().activeVersionId !== publishedVersionId) {
    throw new Error("Le catalogue actif a changé depuis cette archive. Choisissez l’archive correspondant à la version actuellement publiée.");
  }
  const lock = await acquireCatalogPublicationLock(db, publishedVersionId);
  try {
    const lockedActiveRecords = await readActiveCatalog(db);
    await runTransaction(db, async (transaction) => {
      const [currentArchive, currentPointer, activeRecords] = await Promise.all([
        transaction.get(archiveRef),
        transaction.get(pointerRef),
        readCatalogInTransaction(transaction, db, lockedActiveRecords)
      ]);
      if (!currentArchive.exists() || currentArchive.data().status !== "archived" ||
        !currentPointer.exists() ||
        currentPointer.data().activeVersionId !== publishedVersionId ||
        currentPointer.data().publicationLockToken !== lock.token ||
        !(currentPointer.data().publicationLockExpiresAt instanceof Timestamp) ||
        currentPointer.data().publicationLockExpiresAt.toMillis() <= Date.now()) {
        throw new Error("Le catalogue actif ou le verrou temporaire a changé. Choisissez l’archive correspondant à la version actuellement publiée.");
      }
      const mutations = [];
      CATALOG_COLLECTIONS.forEach((name) => {
        mergeRollbackCollection(
          archivedRecords[name],
          publishedRecords[name],
          activeRecords[name]
        ).forEach((mutation) => mutations.push({ name, ...mutation }));
      });
      if (mutations.length > MAX_ATOMIC_PUBLICATION_WRITES - 2) {
        throw new Error("Le retour arrière dépasse la limite d’une bascule atomique sûre. Aucune donnée n’a été modifiée.");
      }
      mutations.forEach((mutation) => {
        const reference = doc(db, mutation.name, mutation.id);
        if (mutation.deleted) transaction.delete(reference);
        else transaction.set(reference, mutation.data);
      });
      transaction.set(pointerRef, {
        activeVersionId: metadata.sourceVersionId || "",
        restoredFromArchiveId: archiveId,
        restoredBy,
        updatedAt: serverTimestamp()
      });
      transaction.update(archiveRef, { restoredAt: serverTimestamp(), restoredBy });
    });
  } catch (error) {
    await throwAfterReleasingLock(db, lock, error);
  }
  return { restored: true };
}
