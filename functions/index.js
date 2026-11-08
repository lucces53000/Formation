const { initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const { logger } = require("firebase-functions");
const { HttpsError, onCall } = require("firebase-functions/v2/https");
const { createHash, randomBytes } = require("node:crypto");

initializeApp();

const ADMIN_EMAIL = "luc.cesbron@sdis53.fr";
const ADMIN_EMAILS = new Set([ADMIN_EMAIL, "formation@sdis53.fr"]);
const db = getFirestore();
const ANNOUNCEMENTS_TOPIC = "announcements";
const MAX_TITLE_LENGTH = 500;
const MAX_MESSAGE_LENGTH = 3000;
const MAX_NOTIFICATION_BYTES = 3500;
const MAX_ATOMIC_PUBLICATION_WRITES = 450;
const CATALOG_COLLECTIONS = [
  "trainings",
  "trainingCategories",
  "trainingLocations",
  "trainingContacts",
  "importantInformation",
  "importantInformationCategories"
];

function requireAdmin(request) {
  const email = request.auth?.token.email?.trim().toLowerCase();
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Une connexion administrateur est nécessaire.");
  }
  if (request.auth.token.email_verified !== true || !ADMIN_EMAILS.has(email)) {
    throw new HttpsError("permission-denied", "Un compte administrateur vérifié est nécessaire.");
  }
  return email;
}

function hashReviewCode(code) {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

function reviewCode() {
  return randomBytes(32).toString("base64url");
}

function requireText(value, label, maximum) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximum) {
    throw new HttpsError("invalid-argument", `${label} est obligatoire et limité à ${maximum} caractères.`);
  }
  return value.trim();
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

function snapshotHash(recordsByCollection) {
  return createHash("sha256").update(stableStringify(recordsByCollection), "utf8").digest("hex");
}

async function readCatalog(collections = CATALOG_COLLECTIONS) {
  const result = {};
  await Promise.all(collections.map(async (name) => {
    const snapshot = await db.collection(name).get();
    result[name] = snapshot.docs.map((item) => ({ id: item.id, data: item.data() }));
  }));
  return result;
}

function collectionRecordsRef(parentRef, name) {
  return parentRef.collection("records").doc(name).collection("items");
}

async function writeCatalogSnapshot(parentRef, recordsByCollection) {
  const operations = [];
  for (const name of CATALOG_COLLECTIONS) {
    for (const record of recordsByCollection[name] || []) {
      operations.push({ ref: collectionRecordsRef(parentRef, name).doc(record.id), data: record.data });
    }
  }

  for (let offset = 0; offset < operations.length; offset += MAX_ATOMIC_PUBLICATION_WRITES) {
    const batch = db.batch();
    operations.slice(offset, offset + MAX_ATOMIC_PUBLICATION_WRITES)
      .forEach(({ ref, data }) => batch.set(ref, data));
    await batch.commit();
  }
}

async function readStoredCatalog(parentRef) {
  const result = {};
  await Promise.all(CATALOG_COLLECTIONS.map(async (name) => {
    const snapshot = await collectionRecordsRef(parentRef, name).get();
    result[name] = snapshot.docs.map((item) => ({ id: item.id, data: item.data() }));
  }));
  return result;
}

function isUnexpired(version) {
  const expiresAt = version.reviewExpiresAt?.toDate?.();
  return expiresAt instanceof Date && expiresAt.getTime() > Date.now();
}

async function loadVersionByCode(code) {
  const normalizedCode = requireText(code, "Le code de relecture", 128);
  const matches = await db.collection("catalogVersions")
    .where("reviewCodeHash", "==", hashReviewCode(normalizedCode))
    .limit(1)
    .get();
  if (matches.empty) {
    throw new HttpsError("permission-denied", "Ce lien de relecture est invalide ou a été révoqué.");
  }
  const version = matches.docs[0];
  const metadata = version.data();
  if (metadata.status !== "in_review" || !isUnexpired(metadata)) {
    throw new HttpsError("failed-precondition", "Cette relecture est terminée, expirée ou n’est pas ouverte.");
  }
  return { version, metadata };
}

async function storeArchive(archiveId, recordsByCollection, metadata) {
  const archiveRef = db.collection("catalogArchives").doc(archiveId);
  await archiveRef.set({
    ...metadata,
    status: "preparing",
    createdAt: FieldValue.serverTimestamp()
  });
  try {
    await writeCatalogSnapshot(archiveRef, recordsByCollection);
  } catch (error) {
    await archiveRef.set({ status: "incomplete" }, { merge: true });
    throw error;
  }
  return archiveRef;
}

function mapRecordsById(records = []) {
  return new Map(records.map((record) => [record.id, stableStringify(record.data)]));
}

function mergeRollbackCollection(archivedRecords, publishedRecords, currentRecords) {
  const archived = new Map(archivedRecords.map((record) => [record.id, record]));
  const published = mapRecordsById(publishedRecords);
  const current = new Map(currentRecords.map((record) => [record.id, record]));
  const allIds = new Set([...archived.keys(), ...published.keys(), ...current.keys()]);
  const mutations = [];

  allIds.forEach((id) => {
    const currentValue = current.has(id) ? stableStringify(current.get(id).data) : undefined;
    const publishedValue = published.get(id);
    if (currentValue !== publishedValue) return;
    const archivedRecord = archived.get(id);
    if (archivedRecord) mutations.push({ id, data: archivedRecord.data });
    else if (current.has(id)) mutations.push({ id, deleted: true });
  });
  return mutations;
}

exports.sendAnnouncementNotification = onCall(
  { region: "europe-west1" },
  async (request) => {
    const email = request.auth?.token.email?.trim().toLowerCase();
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Une connexion est nécessaire pour envoyer une notification.");
    }
    if (request.auth.token.email_verified !== true || email !== ADMIN_EMAIL) {
      throw new HttpsError("permission-denied", "Seul l’administrateur vérifié peut envoyer une notification.");
    }

    const title = typeof request.data?.title === "string" ? request.data.title.trim() : "";
    const message = typeof request.data?.message === "string" ? request.data.message.trim() : "";
    const announcementId = typeof request.data?.announcementId === "string"
      ? request.data.announcementId.trim()
      : "";

    if (!title || !message || !announcementId) {
      throw new HttpsError("invalid-argument", "Le titre, le message et l’identifiant de l’annonce sont obligatoires.");
    }
    if (
      title.length > MAX_TITLE_LENGTH
      || message.length > MAX_MESSAGE_LENGTH
      || Buffer.byteLength(title, "utf8") + Buffer.byteLength(message, "utf8") > MAX_NOTIFICATION_BYTES
    ) {
      throw new HttpsError("invalid-argument", "Le titre ou le message est trop long pour une notification Firebase.");
    }

    if (process.env.FUNCTIONS_EMULATOR === "true") {
      throw new HttpsError("failed-precondition", "L’envoi de notifications est désactivé dans l’émulateur local.");
    }

    if (process.env.FUNCTIONS_EMULATOR === "true") {
      throw new HttpsError("failed-precondition", "L’envoi de notifications est désactivé dans l’émulateur local.");
    }

    try {
      const messageId = await getMessaging().send({
        topic: ANNOUNCEMENTS_TOPIC,
        notification: { title, body: message },
        data: {
          type: "announcement",
          announcementId
        }
      });
      logger.info("Announcement push sent", { announcementId, messageId });
      return { sent: true };
    } catch (error) {
      logger.error("Failed to send announcement push", { announcementId, error });
      throw new HttpsError("internal", "Firebase n’a pas pu envoyer la notification.");
    }
  }
);

exports.createCatalogReviewVersion = onCall(
  { region: "europe-west1" },
  async (request) => {
    const createdBy = requireAdmin(request);
    const year = Number(request.data?.year);
    const title = requireText(request.data?.title, "Le nom de la version", 100);
    if (!Number.isInteger(year) || year < 2000 || year > 2200) {
      throw new HttpsError("invalid-argument", "L’année de la version est invalide.");
    }

    const records = await readCatalog();
    const code = reviewCode();
    const versionRef = db.collection("catalogVersions").doc();
    const baseHash = snapshotHash(records);
    await versionRef.set({
      year,
      title,
      status: "draft",
      createdBy,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      baseHash,
      reviewCodeHash: hashReviewCode(code),
      reviewExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      lastReviewDecision: null,
      lastReviewComment: ""
    });
    try {
      await writeCatalogSnapshot(versionRef, records);
    } catch (error) {
      await versionRef.set({ status: "incomplete" }, { merge: true });
      logger.error("Catalog review snapshot creation failed", { versionId: versionRef.id, error });
      throw new HttpsError("internal", "La copie de relecture n’a pas pu être créée complètement.");
    }
    return { id: versionRef.id, year, title, code, status: "draft" };
  }
);

exports.listCatalogReviewVersions = onCall(
  { region: "europe-west1" },
  async (request) => {
    requireAdmin(request);
    const snapshot = await db.collection("catalogVersions").orderBy("createdAt", "desc").limit(50).get();
    return {
      versions: snapshot.docs.map((item) => {
        const { reviewCodeHash, ...metadata } = item.data();
        if (metadata.createdAt?.toDate) metadata.createdAt = metadata.createdAt.toDate().toISOString();
        if (metadata.updatedAt?.toDate) metadata.updatedAt = metadata.updatedAt.toDate().toISOString();
        if (metadata.submittedAt?.toDate) metadata.submittedAt = metadata.submittedAt.toDate().toISOString();
        if (metadata.reviewedAt?.toDate) metadata.reviewedAt = metadata.reviewedAt.toDate().toISOString();
        if (metadata.publishedAt?.toDate) metadata.publishedAt = metadata.publishedAt.toDate().toISOString();
        if (metadata.archivedAt?.toDate) metadata.archivedAt = metadata.archivedAt.toDate().toISOString();
        return { id: item.id, ...metadata };
      })
    };
  }
);

exports.listCatalogArchives = onCall(
  { region: "europe-west1" },
  async (request) => {
    requireAdmin(request);
    const snapshot = await db.collection("catalogArchives")
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();
    return {
      archives: snapshot.docs.filter((item) => item.data().status === "archived").map((item) => {
        const metadata = item.data();
        return {
          id: item.id,
          beforePublishingVersionId: metadata.beforePublishingVersionId || "",
          sourceVersionId: metadata.sourceVersionId || "",
          restoredAt: metadata.restoredAt?.toDate?.().toISOString() || ""
        };
      })
    };
  }
);

exports.rotateCatalogReviewLink = onCall(
  { region: "europe-west1" },
  async (request) => {
    requireAdmin(request);
    const versionId = requireText(request.data?.versionId, "La version", 128);
    const versionRef = db.collection("catalogVersions").doc(versionId);
    const snapshot = await versionRef.get();
    if (!snapshot.exists || !["draft", "corrections_requested", "in_review"].includes(snapshot.data().status)) {
      throw new HttpsError("failed-precondition", "Cette version ne peut plus recevoir de nouveau lien.");
    }
    const code = reviewCode();
    await versionRef.update({
      reviewCodeHash: hashReviewCode(code),
      reviewExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      status: "draft",
      lastReviewDecision: null,
      lastReviewComment: "",
      updatedAt: FieldValue.serverTimestamp()
    });
    return { code };
  }
);

exports.submitCatalogReviewVersion = onCall(
  { region: "europe-west1" },
  async (request) => {
    requireAdmin(request);
    const versionId = requireText(request.data?.versionId, "La version", 128);
    const versionRef = db.collection("catalogVersions").doc(versionId);
    const version = await versionRef.get();
    if (!version.exists || !["draft", "corrections_requested"].includes(version.data().status)) {
      throw new HttpsError("failed-precondition", "Seule une version en brouillon ou à corriger peut être soumise.");
    }
    await versionRef.update({
      status: "in_review",
      submittedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      lastReviewDecision: null
    });
    return { submitted: true };
  }
);

exports.getCatalogReviewByCode = onCall(
  { region: "europe-west1" },
  async (request) => {
    const { version, metadata } = await loadVersionByCode(request.data?.code);
    const records = await readStoredCatalog(version.ref);
    return {
      version: {
        id: version.id,
        year: metadata.year,
        title: metadata.title,
        status: metadata.status,
        lastReviewComment: metadata.lastReviewComment || ""
      },
      records
    };
  }
);

exports.submitCatalogReviewDecision = onCall(
  { region: "europe-west1" },
  async (request) => {
    const decision = request.data?.decision;
    if (!["approved", "corrections_requested"].includes(decision)) {
      throw new HttpsError("invalid-argument", "La décision de relecture est invalide.");
    }
    const comment = typeof request.data?.comment === "string" ? request.data.comment.trim() : "";
    if (comment.length > 2000) {
      throw new HttpsError("invalid-argument", "Le commentaire est limité à 2 000 caractères.");
    }
    if (decision === "corrections_requested" && !comment) {
      throw new HttpsError("invalid-argument", "Un commentaire est obligatoire pour demander des corrections.");
    }
    const { version } = await loadVersionByCode(request.data?.code);
    await version.ref.update({
      status: decision,
      lastReviewDecision: decision,
      lastReviewComment: comment,
      reviewedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    return { submitted: true };
  }
);

exports.publishCatalogReviewVersion = onCall(
  { region: "europe-west1" },
  async (request) => {
    const publishedBy = requireAdmin(request);
    const versionId = requireText(request.data?.versionId, "La version", 128);
    const versionRef = db.collection("catalogVersions").doc(versionId);
    const versionSnapshot = await versionRef.get();
    if (!versionSnapshot.exists || versionSnapshot.data().status !== "approved") {
      throw new HttpsError("failed-precondition", "La version doit être approuvée avant publication.");
    }

    const newRecords = await readStoredCatalog(versionRef);
    const activeRecords = await readCatalog();
    if (snapshotHash(activeRecords) !== versionSnapshot.data().baseHash) {
      throw new HttpsError(
        "failed-precondition",
        "Le catalogue actif a changé depuis la création de cette copie. Créez une nouvelle version pour éviter d’écraser des modifications."
      );
    }

    const mutations = [];
    for (const collectionName of CATALOG_COLLECTIONS) {
      const current = new Map(activeRecords[collectionName].map((record) => [record.id, record.data]));
      const next = new Map(newRecords[collectionName].map((record) => [record.id, record.data]));
      current.forEach((data, id) => {
        if (!next.has(id)) mutations.push({ collectionName, id, deleted: true });
      });
      next.forEach((data, id) => {
        if (!current.has(id) || stableStringify(current.get(id)) !== stableStringify(data)) {
          mutations.push({ collectionName, id, data });
        }
      });
    }
    if (mutations.length > MAX_ATOMIC_PUBLICATION_WRITES - 4) {
      throw new HttpsError(
        "failed-precondition",
        "La publication dépasse la limite d’une bascule atomique sûre. Aucune donnée publique n’a été modifiée."
      );
    }

    const archiveId = `before-${versionId}`;
    const activePointerRef = db.collection("siteSettings").doc("catalogue");
    const previousVersionId = (await activePointerRef.get()).data()?.activeVersionId || "";
    const archiveRef = await storeArchive(archiveId, activeRecords, {
      sourceVersionId: previousVersionId,
      beforePublishingVersionId: versionId,
      createdBy: publishedBy
    });

    try {
      const batch = db.batch();
      mutations.forEach((mutation) => {
        const ref = db.collection(mutation.collectionName).doc(mutation.id);
        if (mutation.deleted) batch.delete(ref);
        else batch.set(ref, mutation.data);
      });
      batch.set(archiveRef, { status: "archived", archivedAt: FieldValue.serverTimestamp() }, { merge: true });
      if (previousVersionId && previousVersionId !== versionId) {
        batch.set(db.collection("catalogVersions").doc(previousVersionId), {
          status: "archived",
          archivedAt: FieldValue.serverTimestamp()
        }, { merge: true });
      }
      batch.set(versionRef, {
        status: "published",
        publishedBy,
        publishedAt: FieldValue.serverTimestamp(),
        reviewCodeHash: FieldValue.delete(),
        reviewExpiresAt: FieldValue.delete(),
        archiveId
      }, { merge: true });
      batch.set(activePointerRef, {
        activeVersionId: versionId,
        archiveId,
        updatedAt: FieldValue.serverTimestamp()
      });
      await batch.commit();
    } catch (error) {
      logger.error("Catalog publication failed; public records were not partially committed", { versionId, archiveId, error });
      throw new HttpsError("internal", "La publication a échoué. Le catalogue public n’a pas été basculé.");
    }
    return { published: true, archiveId };
  }
);

exports.restoreCatalogArchive = onCall(
  { region: "europe-west1" },
  async (request) => {
    const restoredBy = requireAdmin(request);
    const archiveId = requireText(request.data?.archiveId, "L’archive", 128);
    const archiveRef = db.collection("catalogArchives").doc(archiveId);
    const archiveSnapshot = await archiveRef.get();
    if (!archiveSnapshot.exists || archiveSnapshot.data().status !== "archived") {
      throw new HttpsError("not-found", "Cette archive n’est pas disponible.");
    }
    const publishedVersionId = archiveSnapshot.data().beforePublishingVersionId;
    if (!publishedVersionId) {
      throw new HttpsError(
        "failed-precondition",
        "Le catalogue actif précédent était une version historique sans identifiant de version. Utilisez la copie archivée pour une restauration manuelle contrôlée."
      );
    }
    const activePointerRef = db.collection("siteSettings").doc("catalogue");
    const pointer = await activePointerRef.get();
    if (pointer.data()?.activeVersionId !== publishedVersionId) {
      throw new HttpsError(
        "failed-precondition",
        "Le catalogue a été publié de nouveau depuis cette archive. Choisissez l’archive correspondant à la version actuellement publiée."
      );
    }

    const [archivedRecords, publishedRecords, activeRecords] = await Promise.all([
      readStoredCatalog(archiveRef),
      readStoredCatalog(db.collection("catalogVersions").doc(publishedVersionId)),
      readCatalog()
    ]);
    const mutations = [];
    for (const collectionName of CATALOG_COLLECTIONS) {
      mergeRollbackCollection(
        archivedRecords[collectionName],
        publishedRecords[collectionName],
        activeRecords[collectionName]
      ).forEach((mutation) => mutations.push({ collectionName, ...mutation }));
    }
    if (mutations.length > MAX_ATOMIC_PUBLICATION_WRITES - 2) {
      throw new HttpsError(
        "failed-precondition",
        "Le retour arrière nécessite trop de changements atomiques. Aucune donnée n’a été modifiée."
      );
    }

    const batch = db.batch();
    mutations.forEach((mutation) => {
      const ref = db.collection(mutation.collectionName).doc(mutation.id);
      if (mutation.deleted) batch.delete(ref);
      else batch.set(ref, mutation.data);
    });
    batch.set(activePointerRef, {
      activeVersionId: archiveSnapshot.data().sourceVersionId || "",
      restoredFromArchiveId: archiveId,
      restoredBy,
      updatedAt: FieldValue.serverTimestamp()
    });
    batch.set(archiveRef, { restoredAt: FieldValue.serverTimestamp(), restoredBy }, { merge: true });
    await batch.commit();
    return { restored: true, preservedConcurrentChanges: true };
  }
);
