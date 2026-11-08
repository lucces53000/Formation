const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { GeoPoint, Timestamp, getFirestore } = require("firebase-admin/firestore");

const FORMAT_VERSION = 1;
const MAX_BATCH_WRITES = 400;
const SPARK_DAILY_WRITE_AND_DELETE_QUOTA = 18000;
const REPOSITORY_ROOT = path.resolve(__dirname, "..", "..");

function parseArguments(argv) {
  const [command, ...args] = argv;
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("--")) throw new Error(`Argument inconnu : ${argument}`);
    const [key, inlineValue] = argument.slice(2).split("=", 2);
    if (key === "apply") {
      options.apply = true;
      continue;
    }
    const value = inlineValue ?? args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Valeur manquante pour --${key}.`);
    options[key] = value;
    if (inlineValue === undefined) index += 1;
  }
  if (!["backup", "restore"].includes(command)) {
    throw new Error("Usage : node scripts/firestore-backup.js backup|restore --project PROJECT_ID [--file FILE] [--apply]");
  }
  if (!options.project) throw new Error("Précisez explicitement le projet avec --project.");
  if (command === "restore" && !options.file) throw new Error("Précisez le fichier de sauvegarde avec --file.");
  return { command, options };
}

function encodeValue(value) {
  if (value instanceof Timestamp) {
    return { __firestoreBackupType: "timestamp", seconds: value.seconds, nanoseconds: value.nanoseconds };
  }
  if (value instanceof Date) {
    const timestamp = Timestamp.fromDate(value);
    return { __firestoreBackupType: "timestamp", seconds: timestamp.seconds, nanoseconds: timestamp.nanoseconds };
  }
  if (value instanceof GeoPoint) {
    return { __firestoreBackupType: "geoPoint", latitude: value.latitude, longitude: value.longitude };
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { __firestoreBackupType: "bytes", base64: Buffer.from(value).toString("base64") };
  }
  if (Array.isArray(value)) return value.map(encodeValue);
  if (value && typeof value === "object" && typeof value.path === "string" && value.firestore) {
    return { __firestoreBackupType: "reference", path: value.path };
  }
  if (value && typeof value === "object") {
    const entries = Object.keys(value).sort().map((key) => [key, encodeValue(value[key])]);
    return { __firestoreBackupType: "map", entries };
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    return { __firestoreBackupType: "number", value: String(value) };
  }
  return value;
}

function decodeValue(value, db) {
  if (Array.isArray(value)) return value.map((item) => decodeValue(item, db));
  if (!value || typeof value !== "object") return value;
  switch (value.__firestoreBackupType) {
    case "timestamp":
      return new Timestamp(value.seconds, value.nanoseconds);
    case "geoPoint":
      return new GeoPoint(value.latitude, value.longitude);
    case "bytes":
      return Buffer.from(value.base64, "base64");
    case "reference":
      return db.doc(value.path);
    case "number":
      return value.value === "NaN" ? Number.NaN : Number(value.value);
    case "map":
      return Object.fromEntries(value.entries.map(([key, item]) => [key, decodeValue(item, db)]));
    default:
      throw new Error("Le fichier contient une valeur Firestore inconnue ou n’est pas une sauvegarde prise en charge.");
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function checksum(documents) {
  return crypto.createHash("sha256").update(canonicalJson(documents), "utf8").digest("hex");
}

function defaultBackupDirectory(projectId) {
  const home = process.env.USERPROFILE || process.env.HOME;
  if (!home) throw new Error("Impossible de déterminer votre dossier utilisateur Windows.");
  return path.join(home, "Documents", "FirestoreBackups", projectId);
}

function assertOutsideRepository(filePath) {
  const relativePath = path.relative(REPOSITORY_ROOT, filePath);
  if (!relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
    throw new Error("Le fichier de sauvegarde doit être enregistré hors du dépôt du projet.");
  }
}

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function collectCollection(collectionRef, documents) {
  const snapshot = await collectionRef.get();
  for (const document of snapshot.docs) {
    documents.push({ path: document.ref.path, data: encodeValue(document.data()) });
    const nestedCollections = await document.ref.listCollections();
    for (const nestedCollection of nestedCollections) {
      await collectCollection(nestedCollection, documents);
    }
  }
}

async function readDatabase(db) {
  const documents = [];
  const collections = await db.listCollections();
  for (const collection of collections) await collectCollection(collection, documents);
  documents.sort((left, right) => left.path.localeCompare(right.path));
  return documents;
}

async function writeBackup(db, projectId, requestedFile) {
  const documents = await readDatabase(db);
  const payload = {
    formatVersion: FORMAT_VERSION,
    projectId,
    createdAt: new Date().toISOString(),
    documentCount: documents.length,
    sha256: checksum(documents),
    documents
  };
  const filePath = path.resolve(requestedFile || path.join(
    defaultBackupDirectory(projectId),
    `firestore-${projectId}-${timestampForFile()}.json`
  ));
  assertOutsideRepository(filePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, { flag: "wx" });
  return { filePath, documentCount: documents.length, sha256: payload.sha256 };
}

async function readAndValidateBackup(filePath, projectId) {
  const payload = JSON.parse(await fs.readFile(filePath, "utf8"));
  if (payload.formatVersion !== FORMAT_VERSION) throw new Error("Version de sauvegarde non prise en charge.");
  if (payload.projectId !== projectId) {
    throw new Error(`Le fichier vise le projet « ${payload.projectId} », pas « ${projectId} ».`);
  }
  if (!Array.isArray(payload.documents) || payload.documents.length !== payload.documentCount) {
    throw new Error("Le nombre de documents du fichier ne correspond pas à ses métadonnées.");
  }
  if (checksum(payload.documents) !== payload.sha256) {
    throw new Error("La vérification SHA-256 a échoué. Le fichier est incomplet ou modifié.");
  }
  const seenPaths = new Set();
  for (const item of payload.documents) {
    if (!item || typeof item.path !== "string" || !item.path || seenPaths.has(item.path)) {
      throw new Error("Le fichier contient un chemin de document invalide ou dupliqué.");
    }
    seenPaths.add(item.path);
    if (item.path.split("/").length % 2 !== 0) throw new Error(`Chemin Firestore invalide : ${item.path}`);
  }
  return payload;
}

async function confirmRestore(projectId) {
  const input = readline.createInterface({ input: stdin, output: stdout });
  try {
    const answer = await input.question(`Tapez RESTORE ${projectId} pour confirmer le remplacement complet de la base : `);
    if (answer !== `RESTORE ${projectId}`) throw new Error("Confirmation incorrecte. Aucune donnée n’a été modifiée.");
  } finally {
    input.close();
  }
}

async function applyRestore(db, backupDocuments, currentDocuments) {
  const backupByPath = new Map(backupDocuments.map((item) => [item.path, item]));
  const currentByPath = new Map(currentDocuments.map((item) => [item.path, item]));
  const operations = [];

  for (const [documentPath, item] of backupByPath) {
    const current = currentByPath.get(documentPath);
    const backupJson = canonicalJson(item.data);
    if (!current || canonicalJson(encodeValue(current.data)) !== backupJson) {
      operations.push({ path: documentPath, data: decodeValue(item.data, db) });
    }
  }
  for (const documentPath of currentByPath.keys()) {
    if (!backupByPath.has(documentPath)) operations.push({ path: documentPath, delete: true });
  }

  const writes = operations.length;
  if (writes > SPARK_DAILY_WRITE_AND_DELETE_QUOTA) {
    throw new Error(
      `La restauration nécessiterait ${writes} écritures/suppressions, au-delà de la marge prudente quotidienne Spark (${SPARK_DAILY_WRITE_AND_DELETE_QUOTA}). Aucune donnée n’a été modifiée.`
    );
  }
  if (writes === 0) {
    console.log("La base correspond déjà exactement à la sauvegarde. Aucune modification nécessaire.");
    return;
  }

  for (let offset = 0; offset < operations.length; offset += MAX_BATCH_WRITES) {
    const batch = db.batch();
    operations.slice(offset, offset + MAX_BATCH_WRITES).forEach((operation) => {
      const reference = db.doc(operation.path);
      if (operation.delete) batch.delete(reference);
      else batch.set(reference, operation.data);
    });
    await batch.commit();
    console.log(`Lot ${Math.floor(offset / MAX_BATCH_WRITES) + 1} appliqué (${Math.min(offset + MAX_BATCH_WRITES, writes)}/${writes}).`);
  }
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  const projectId = options.project.trim();
  const appOptions = { projectId };
  if (!process.env.FIRESTORE_EMULATOR_HOST) appOptions.credential = applicationDefault();
  const app = initializeApp(appOptions, `firestore-backup-${projectId}`);
  const db = getFirestore(app);

  if (command === "backup") {
    const result = await writeBackup(db, projectId, options.file);
    console.log(`Sauvegarde créée : ${result.filePath}`);
    console.log(`Documents : ${result.documentCount}`);
    console.log(`SHA-256 : ${result.sha256}`);
    return;
  }

  const backupPath = path.resolve(options.file);
  assertOutsideRepository(backupPath);
  const backup = await readAndValidateBackup(backupPath, projectId);
  const current = await readDatabase(db);
  const backupPaths = new Set(backup.documents.map((item) => item.path));
  const currentPaths = new Set(current.map((item) => item.path));
  const additions = backup.documents.filter((item) => !currentPaths.has(item.path)).length;
  const deletions = current.filter((item) => !backupPaths.has(item.path)).length;
  const updates = backup.documents.length - additions;
  console.log(`Aperçu de restauration vers ${projectId}:`);
  console.log(`  Sauvegarde : ${backup.documents.length} documents (${backup.createdAt})`);
  console.log(`  État actuel : ${current.length} documents`);
  console.log(`  À créer : ${additions}; à remplacer : ${updates}; à supprimer : ${deletions}`);
  if (!options.apply) {
    console.log("Aperçu uniquement. Relancez avec --apply pour demander confirmation et appliquer la restauration.");
    return;
  }

  const currentBackup = await writeBackup(db, projectId);
  console.log(`Sauvegarde de sécurité de l’état actuel : ${currentBackup.filePath}`);
  await confirmRestore(projectId);
  await applyRestore(db, backup.documents, current);
  console.log("Restauration terminée. Vérifiez le catalogue et les données de l’administration.");
}

main().catch((error) => {
  console.error(`Erreur : ${error.message}`);
  process.exitCode = 1;
});
