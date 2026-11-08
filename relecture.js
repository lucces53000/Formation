import { firebaseConfig } from "./firebase-config.js";
import {
  connectFirebaseEmulators,
  getFirebaseConfig
} from "./firebase-environment.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getFirestore
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import {
  loadCatalogReviewByCode,
  submitCatalogReviewDecision
} from "./catalog-review-workflow.js";

const status = document.querySelector("#review-status");
const content = document.querySelector("#review-content");
const recordsContainer = document.querySelector("#review-records");
const commentField = document.querySelector("#review-comment");
const reviewCode = new URLSearchParams(window.location.search).get("code") || "";
const app = initializeApp(getFirebaseConfig(firebaseConfig));
const db = getFirestore(app);
connectFirebaseEmulators({ db });

function createText(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function renderTraining(training) {
  const card = createText("article", "review-record", "");
  const category = [training.category, training.subCategory].filter(Boolean).join(" · ");
  card.append(createText("p", "section-kicker", category || "Sans catégorie"));
  card.append(createText("h3", "", training.title || training.id));
  if (training.published === false) card.append(createText("p", "", "Cet élément est masqué dans la copie."));
  if (training.summary) card.append(createText("p", "", training.summary));
  if (training.duration) card.append(createText("p", "", `Durée : ${training.duration}`));
  if (training.prerequisites) card.append(createText("p", "", `Prérequis : ${training.prerequisites}`));
  if (training.observations) card.append(createText("p", "", `Observations : ${training.observations}`));
  const sessions = [
    ...(Array.isArray(training.sessions) ? training.sessions : []),
    ...(Array.isArray(training.phases)
      ? training.phases.flatMap((phase) =>
        (Array.isArray(phase.sessions) ? phase.sessions : [])
          .map((session) => ({ ...session, phaseTitle: phase.phaseTitle || "" }))
      )
      : [])
  ];
  if (sessions.length > 0) {
    const list = document.createElement("ul");
    sessions.forEach((session) => {
      const period = [session.startDate, session.endDate].filter(Boolean).join(" au ");
      const description = [
        session.phaseTitle,
        session.sessionName,
        period,
        session.location
      ].filter(Boolean).join(" · ");
      list.append(createText("li", "", description || "Session sans date"));
    });
    card.append(list);
  }
  return card;
}

function renderImportantInformation(record, categoryById) {
  const card = createText("article", "review-record", "");
  card.append(createText("p", "section-kicker", categoryById.get(record.categoryId) || "Sans catégorie"));
  card.append(createText("h3", "", record.title || "Information"));
  if (record.published === false) card.append(createText("p", "", "Cet élément est masqué dans la copie."));
  if (record.description) card.append(createText("p", "", record.description));
  if (record.recurrence) card.append(createText("p", "", `Récurrence : ${record.recurrence}`));
  if (Array.isArray(record.dates) && record.dates.length > 0) {
    const list = document.createElement("ul");
    record.dates.forEach((date) => {
      list.append(createText("li", "", [date.date, date.label, date.location].filter(Boolean).join(" · ") || "Date à définir"));
    });
    card.append(list);
  }
  return card;
}

function renderRecords(records) {
  const categories = new Map((records.trainingCategories || [])
    .map((record) => [record.id, record.data.name || record.id]));
  const informationCategories = new Map((records.importantInformationCategories || [])
    .map((record) => [record.id, record.data.name || record.id]));
  const trainings = (records.trainings || [])
    .map((record) => ({ ...record.data, id: record.id }))
    .sort((left, right) =>
      (categories.get(left.category) || left.category || "").localeCompare(
        categories.get(right.category) || right.category || "",
        "fr"
      ) || String(left.title || left.id).localeCompare(String(right.title || right.id), "fr")
    );
  const information = (records.importantInformation || [])
    .map((record) => ({ ...record.data, id: record.id }))
    .sort((left, right) => String(left.title || "").localeCompare(String(right.title || ""), "fr"));
  recordsContainer.replaceChildren(
    createText("h2", "", `Formations (${trainings.length})`),
    ...trainings.map(renderTraining),
    createText("h2", "", `Dates et informations à retenir (${information.length})`),
    ...information.map((record) => renderImportantInformation(record, informationCategories))
  );
}

async function submitDecision(decision) {
  const comment = commentField.value.trim();
  if (decision === "corrections_requested" && !comment) {
    status.textContent = "Ajoutez un commentaire pour demander des corrections.";
    status.classList.add("review-error");
    commentField.focus();
    return;
  }
  const label = decision === "approved" ? "approuver cette version" : "demander des corrections";
  if (!window.confirm(`Confirmer votre décision : ${label} ?`)) return;
  document.querySelector("#approve-review").disabled = true;
  document.querySelector("#request-corrections").disabled = true;
  try {
    await submitCatalogReviewDecision(db, { code: reviewCode, decision, comment });
    content.hidden = true;
    status.textContent = decision === "approved"
      ? "Votre approbation a été transmise. La version n’est pas encore publiée."
      : "Votre demande de corrections a été transmise aux administrateurs.";
    status.classList.remove("review-error");
  } catch (error) {
    status.textContent = `La décision n’a pas pu être enregistrée : ${error.message}`;
    status.classList.add("review-error");
    document.querySelector("#approve-review").disabled = false;
    document.querySelector("#request-corrections").disabled = false;
  }
}

document.querySelector("#approve-review").addEventListener("click", () => submitDecision("approved"));
document.querySelector("#request-corrections").addEventListener("click", () => submitDecision("corrections_requested"));

async function loadReview() {
  if (!reviewCode) {
    status.textContent = "Lien incomplet. Demandez un nouveau lien aux administrateurs.";
    status.classList.add("review-error");
    return;
  }
  try {
    const result = await loadCatalogReviewByCode(db, reviewCode);
    document.querySelector("#review-title").textContent = `${result.version.title} · ${result.version.year}`;
    renderRecords(result.records);
    content.hidden = false;
    status.textContent = "Version en cours de relecture. Aucune modification ne sera publiée par cette page.";
    window.history.replaceState({}, document.title, window.location.pathname);
  } catch (error) {
    status.textContent = `Accès refusé : ${error.message}`;
    status.classList.add("review-error");
  }
}

loadReview();
