import { firebaseConfig } from "./firebase-config.js";
import {
  connectFirebaseEmulators,
  getFirebaseConfig
} from "./firebase-environment.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  getFirestore
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import {
  createCatalogReviewVersion,
  deleteCatalogReviewVersion,
  listCatalogReviewData,
  publishCatalogReviewVersion,
  restoreCatalogArchive,
  rotateCatalogReviewLink,
  submitCatalogReviewVersion
} from "./catalog-review-workflow.js";

const adminEmails = ["luc.cesbron@sdis53.fr", "formation@sdis53.fr"];
const loginPanel = document.querySelector("#login-panel");
const versionsPanel = document.querySelector("#versions-panel");
const workspace = document.querySelector("#versions-workspace");
const accessStatus = document.querySelector("#access-status");
const status = document.querySelector("#versions-status");
const reviewVersionsList = document.querySelector("#review-versions-list");
const catalogArchivesList = document.querySelector("#catalog-archives-list");
const reviewLinkResult = document.querySelector("#review-link-result");
const createForm = document.querySelector("#create-version-form");
const createButton = document.querySelector("#create-version-button");
const signOutButton = document.querySelector("#sign-out");
const verificationNotice = document.querySelector("#verification-notice");
const isConfigured = ["apiKey", "authDomain", "projectId", "appId"]
  .every((key) => Boolean(firebaseConfig[key]));

let auth;
let db;
let versions = [];

function showStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function setAccessStatus(message, isError = false) {
  accessStatus.textContent = message;
  accessStatus.classList.toggle("error", isError);
}

function isAuthorized(user) {
  return user?.emailVerified &&
    adminEmails.includes(String(user.email || "").trim().toLocaleLowerCase("fr"));
}

function makeButton(label, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

function showReviewLink(code, version) {
  const link = new URL("./relecture.html", window.location.href);
  link.searchParams.set("code", code);
  const message = document.createElement("p");
  message.textContent = `Version « ${version.title} · ${version.year} » créée. Copiez ce lien maintenant : il ne sera affiché qu’une seule fois.`;
  const anchor = document.createElement("a");
  anchor.href = link.href;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.textContent = link.href;
  const copyButton = makeButton("Copier le lien", "button secondary", async () => {
    try {
      await navigator.clipboard.writeText(link.href);
      showStatus("Lien de relecture copié.");
    } catch (error) {
      showStatus(`Impossible de copier le lien : ${error.message}`, true);
    }
  });
  reviewLinkResult.replaceChildren(message, anchor, copyButton);
  reviewLinkResult.hidden = false;
  reviewLinkResult.scrollIntoView({ behavior: "smooth", block: "center" });
}

function makeVersionCard(version) {
  const labels = {
    draft: "Brouillon",
    in_review: "En relecture",
    corrections_requested: "Corrections demandées",
    approved: "Approuvée",
    published: "Publiée",
    archived: "Archivée",
    incomplete: "Copie incomplète — ne pas publier",
    deleting: "Suppression en cours"
  };
  const card = document.createElement("article");
  card.className = "catalog-version-card";
  const details = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = `${version.title} · ${version.year}`;
  const state = document.createElement("p");
  state.className = "version-status";
  state.textContent = labels[version.status] || version.status;
  details.append(title, state);
  if (version.lastReviewComment) {
    const comment = document.createElement("p");
    comment.textContent = `Commentaire de relecture : ${version.lastReviewComment}`;
    details.append(comment);
  }
  const actions = document.createElement("div");
  actions.className = "catalog-version-actions";
  const deletableStatuses = [
    "draft",
    "in_review",
    "corrections_requested",
    "approved",
    "incomplete",
    "deleting"
  ];
  if (version.status === "deleting") {
    const deletionNote = document.createElement("p");
    deletionNote.textContent = "La suppression a été interrompue. Relancez-la pour terminer.";
    details.append(deletionNote);
    actions.append(makeButton("Reprendre la suppression", "button danger", () => deleteVersion(version, true)));
  } else if (["draft", "corrections_requested"].includes(version.status)) {
    actions.append(makeButton("Modifier cette copie", "button secondary", () => {
      const url = new URL("./admin.html", window.location.href);
      url.searchParams.set("catalogVersionId", version.id);
      window.location.assign(url.href);
    }));
    actions.append(makeButton(
      version.status === "draft" ? "Soumettre à la relecture" : "Renvoyer en relecture",
      "button secondary",
      () => submitVersion(version)
    ));
  } else if (version.status === "in_review") {
    actions.append(makeButton("Révoquer et remplacer le lien", "button secondary", () => rotateLink(version)));
  } else if (version.status === "approved") {
    actions.append(makeButton("Publier cette version", "button primary", () => publishVersion(version)));
  }
  if (deletableStatuses.includes(version.status) && version.status !== "deleting") {
    actions.append(makeButton("Supprimer cette version", "button danger", () => deleteVersion(version)));
  }
  card.append(details, actions);
  return card;
}

function renderVersions() {
  reviewVersionsList.replaceChildren();
  if (versions.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Aucune version de relecture créée.";
    reviewVersionsList.append(empty);
    return;
  }
  versions.forEach((version) => reviewVersionsList.append(makeVersionCard(version)));
}

async function refreshVersions() {
  const { versions: loadedVersions, archives } = await listCatalogReviewData(db);
  versions = loadedVersions;
  renderVersions();
  renderArchives(archives);
}

async function refreshAfterAction(message) {
  showStatus(message);
  try {
    await refreshVersions();
  } catch (error) {
    showStatus(`${message} La liste n’a pas pu être actualisée : ${error.message}`, true);
  }
}

function renderArchives(archives) {
  catalogArchivesList.replaceChildren();
  if (archives.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Aucun catalogue remplacé n’est archivé.";
    catalogArchivesList.append(empty);
    return;
  }
  archives.forEach((archive) => {
    const card = document.createElement("article");
    card.className = "catalog-version-card";
    const details = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = "Catalogue archivé";
    const description = document.createElement("p");
    description.textContent = archive.beforePublishingVersionId
      ? `Archive créée avant la publication de la version ${archive.beforePublishingVersionId}.`
      : "Archive du catalogue précédent.";
    details.append(title, description);
    const actions = document.createElement("div");
    actions.className = "catalog-version-actions";
    actions.append(makeButton("Restaurer cette archive", "button secondary", async () => {
      if (!window.confirm("Restaurer cette archive ? Vérifiez le catalogue après le retour arrière.")) return;
      try {
        await restoreCatalogArchive(db, archive.id, auth.currentUser.email);
        await refreshAfterAction("Archive restaurée. Les changements postérieurs non conflictuels ont été conservés.");
      } catch (error) {
        showStatus(`Impossible de restaurer l’archive : ${error.message}`, true);
      }
    }));
    card.append(details, actions);
    catalogArchivesList.append(card);
  });
}

async function submitVersion(version) {
  if (!window.confirm(`Soumettre « ${version.title} » à la relecture ? La copie sera figée jusqu’à une demande de corrections.`)) return;
  try {
    await submitCatalogReviewVersion(db, version.id);
    await refreshAfterAction("Version soumise à la relecture.");
  } catch (error) {
    showStatus(`Impossible de soumettre la version : ${error.message}`, true);
  }
}

async function rotateLink(version) {
  if (!window.confirm("L’ancien lien cessera immédiatement de fonctionner. Créer un nouveau lien de relecture ?")) return;
  try {
    const result = await rotateCatalogReviewLink(db, version.id);
    showReviewLink(result.code, version);
    showStatus("Ancien lien révoqué. Partagez le nouveau lien.");
    try {
      await refreshVersions();
    } catch (error) {
      showStatus(`Nouveau lien créé, mais la liste n’a pas pu être actualisée : ${error.message}`, true);
    }
  } catch (error) {
    showStatus(`Impossible de renouveler le lien : ${error.message}`, true);
  }
}

async function publishVersion(version) {
  if (!window.confirm(`Publier « ${version.title} » ? Le catalogue public actuel sera archivé et remplacé.`)) return;
  try {
    await publishCatalogReviewVersion(db, version.id, auth.currentUser.email);
    await refreshAfterAction("Nouvelle version publiée. L’ancien catalogue est archivé et la relecture est désactivée.");
  } catch (error) {
    showStatus(`Impossible de publier la version : ${error.message}`, true);
  }
}

async function deleteVersion(version, resume = false) {
  const message = resume
    ? `Terminer la suppression de « ${version.title} » ?`
    : `Supprimer définitivement « ${version.title} » et son lien de relecture ? Cette action est réservée aux versions non publiées et ne modifie pas le catalogue public.`;
  if (!window.confirm(message)) return;
  try {
    await deleteCatalogReviewVersion(db, version.id);
    await refreshAfterAction(`La version « ${version.title} » et son lien de relecture ont été supprimés.`);
  } catch (error) {
    showStatus(`Suppression incomplète de « ${version.title} » : ${error.message}. Si elle apparaît toujours comme « Suppression en cours », relancez sa suppression.`, true);
    try {
      await refreshVersions();
    } catch (refreshError) {
      showStatus(`Suppression incomplète : ${error.message}. Impossible d’actualiser la liste : ${refreshError.message}`, true);
    }
  }
}

createForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const year = Number(createForm.elements.year.value);
  const title = createForm.elements.title.value.trim();
  if (!Number.isInteger(year) || year < 2000 || year > 2200 || !title) {
    showStatus("Renseignez une année et un nom de version valides.", true);
    return;
  }
  createButton.disabled = true;
  reviewLinkResult.hidden = true;
  try {
    const version = await createCatalogReviewVersion(db, {
      year,
      title,
      createdBy: auth.currentUser.email
    });
    showReviewLink(version.code, version);
    showStatus("Copie créée. Elle est distincte du catalogue public.");
    try {
      await refreshVersions();
    } catch (error) {
      showStatus(`Version créée et lien affiché, mais la liste n’a pas pu être actualisée : ${error.message}`, true);
    }
  } catch (error) {
    showStatus(`Impossible de créer la version : ${error.message}`, true);
  } finally {
    createButton.disabled = false;
  }
});

document.querySelector("#refresh-versions").addEventListener("click", async () => {
  try {
    await refreshVersions();
    showStatus("Liste des versions actualisée.");
  } catch (error) {
    showStatus(`Impossible d’actualiser les versions : ${error.message}`, true);
  }
});

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await signInWithEmailAndPassword(auth, form.elements.email.value, form.elements.password.value);
    form.reset();
  } catch (error) {
    setAccessStatus(`Connexion impossible : ${error.message}`, true);
  }
});

signOutButton.addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch (error) {
    setAccessStatus(`Déconnexion impossible : ${error.message}`, true);
  }
});

document.querySelector("#resend-verification").addEventListener("click", async () => {
  if (!auth.currentUser || auth.currentUser.emailVerified) return;
  try {
    await sendEmailVerification(auth.currentUser);
    setAccessStatus(`Courriel de vérification envoyé à ${auth.currentUser.email}.`);
  } catch (error) {
    setAccessStatus(`Impossible d’envoyer le courriel : ${error.message}`, true);
  }
});

const yearField = document.querySelector("#version-year");
const titleField = document.querySelector("#version-title");
yearField.value = String(new Date().getFullYear() + 1);
titleField.value = `Catalogue ${yearField.value}`;
yearField.addEventListener("input", () => {
  if (titleField.value.startsWith("Catalogue ")) {
    titleField.value = `Catalogue ${yearField.value}`;
  }
});

if (!isConfigured) {
  setAccessStatus("Configuration Firebase manquante. Vérifiez firebase-config.js.", true);
} else {
  const app = initializeApp(getFirebaseConfig(firebaseConfig));
  auth = getAuth(app);
  db = getFirestore(app);
  connectFirebaseEmulators({ auth, db });
  onAuthStateChanged(auth, async (user) => {
    loginPanel.classList.toggle("hidden", Boolean(user));
    versionsPanel.classList.toggle("hidden", !user);
    verificationNotice.classList.toggle("hidden", !user || user.emailVerified);
    workspace.classList.add("hidden");
    if (!user) {
      document.querySelector("#signed-in-as").textContent = "";
      setAccessStatus("");
      return;
    }
    document.querySelector("#signed-in-as").textContent = `Connecté en tant que ${user.email || user.uid}`;
    if (!user.emailVerified) {
      setAccessStatus("Vérifiez l’adresse e-mail du compte pour accéder à la gestion des versions.", true);
      return;
    }
    if (!isAuthorized(user)) {
      setAccessStatus("Cette page est réservée aux comptes administrateur autorisés.", true);
      return;
    }
    try {
      await user.getIdToken(true);
      await refreshVersions();
      workspace.classList.remove("hidden");
      setAccessStatus("");
    } catch (error) {
      setAccessStatus(`Impossible de charger la gestion des versions : ${error.message}`, true);
    }
  });
}
