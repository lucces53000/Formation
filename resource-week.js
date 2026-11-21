import { firebaseConfig } from "./firebase-config.js";
import {
  connectFirebaseEmulators,
  getFirebaseConfig
} from "./firebase-environment.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  collection,
  getDocs,
  getFirestore
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const app = initializeApp(getFirebaseConfig(firebaseConfig));
const db = getFirestore(app);
connectFirebaseEmulators({ db });

const grid = document.querySelector("#public-resource-week-grid");
const weekLabel = document.querySelector("#public-resource-week-label");
const summary = document.querySelector("#public-resource-summary");
const statusElement = document.querySelector("#public-resource-status");

const selectedWeek = new Date();
selectedWeek.setUTCHours(0, 0, 0, 0);
selectedWeek.setUTCDate(selectedWeek.getUTCDate() - ((selectedWeek.getUTCDay() + 6) % 7));

let trainings = [];
let resources = [];
let assignments = [];
let sessions = [];

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function parseIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toISOString().slice(0, 10) === value ? date : null;
}

function formatIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function formatDate(date) {
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC"
  }).format(date);
}

function formatCaseDate(date) {
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function formatDateRange(startDate, endDate) {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate) || start;
  if (!start) return "Date non renseignée";
  if (formatIsoDate(start) === formatIsoDate(end)) return formatDate(start);
  return `${formatDate(start)} au ${formatDate(end)}`;
}

function stableSessionId(trainingId, kind, phaseIndex, sessionIndex) {
  return `${trainingId}|${kind}|${phaseIndex ?? ""}|${sessionIndex}`;
}

function sessionEntries(training, trainingId) {
  if (training.resourcesEnabled !== true) return [];
  const result = [];
  (Array.isArray(training.sessions) ? training.sessions : []).forEach((session, sessionIndex) => {
    result.push({
      trainingId,
      trainingTitle: training.title || training.id || "Formation sans titre",
      sessionId: stableSessionId(trainingId, "direct", null, sessionIndex),
      sessionName: String(session.sessionName || "").trim(),
      startDate: session.startDate || "",
      endDate: session.endDate || session.startDate || "",
      location: String(session.location || "").trim(),
      cancelled: session.cancelled === true
    });
  });
  (Array.isArray(training.phases) ? training.phases : []).forEach((phase, phaseIndex) => {
    (Array.isArray(phase.sessions) ? phase.sessions : []).forEach((session, sessionIndex) => {
      result.push({
        trainingId,
        trainingTitle: training.title || training.id || "Formation sans titre",
        sessionId: stableSessionId(trainingId, "phase", phaseIndex, sessionIndex),
        sessionName: [phase.phaseTitle, session.sessionName].filter(Boolean).join(" · "),
        startDate: session.startDate || "",
        endDate: session.endDate || session.startDate || "",
        location: String(session.location || "").trim(),
        cancelled: session.cancelled === true
      });
    });
  });
  return result;
}

function assignmentResourceIds(assignment) {
  if (Array.isArray(assignment.resourceIds)) return assignment.resourceIds;
  return assignment.resourceId ? [assignment.resourceId] : [];
}

async function loadData() {
  statusElement.textContent = "Chargement des affectations…";
  try {
    const [trainingSnapshot, resourceSnapshot, assignmentSnapshot] = await Promise.all([
      getDocs(collection(db, "trainings")),
      getDocs(collection(db, "resources")),
      getDocs(collection(db, "resourceAssignments"))
    ]);
    trainings = trainingSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    resources = resourceSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    assignments = assignmentSnapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .filter((item) => item.status !== "cancelled");
    sessions = trainings.flatMap((training) => sessionEntries(training, training.id));
    renderWeek();
    statusElement.textContent = "";
  } catch (error) {
    statusElement.textContent = `Impossible de charger le calendrier : ${error.message}`;
    statusElement.classList.add("error");
  }
}

function getEntries(dateKey) {
  const entries = [];
  assignments.filter((assignment) =>
    assignment.startDate <= dateKey &&
    (assignment.endDate || assignment.startDate) >= dateKey
  ).forEach((assignment) => {
    const session = sessions.find((item) => item.sessionId === assignment.sessionId);
    if (!session || session.cancelled) return;
    assignmentResourceIds(assignment).forEach((resourceId) => {
      const resource = resources.find((item) => item.id === resourceId);
      if (!resource) return;
      entries.push({
        resourceName: resource.name,
        immatriculation: resource.immatriculation || "",
        cis: resource.cis || "",
        contact: assignment.contact || "",
        notes: assignment.notes || "",
        trainingTitle: session.trainingTitle,
        sessionName: session.sessionName,
        location: session.location,
        startDate: assignment.startDate,
        endDate: assignment.endDate || assignment.startDate
      });
    });
    if (assignment.temporaryResource) {
      const temporaryResources = Array.isArray(assignment.temporaryResources)
        ? assignment.temporaryResources
        : [{
          name: assignment.temporaryName || "Véhicule ponctuel",
          registration: assignment.temporaryRegistration || "",
          cis: assignment.temporaryCis || ""
        }];
      temporaryResources.forEach((temporary) => {
        entries.push({
          resourceName: temporary.name || "Véhicule ponctuel",
          immatriculation: temporary.registration || "",
          cis: temporary.cis || "",
          contact: assignment.contact || "",
          notes: assignment.notes || "",
          trainingTitle: session.trainingTitle,
          sessionName: session.sessionName,
          location: session.location,
          startDate: assignment.startDate,
          endDate: assignment.endDate || assignment.startDate
        });
      });
    }
  });
  const unique = new Map();
  entries.forEach((entry) => {
    const key = `${entry.resourceName}|${entry.immatriculation}|${entry.trainingTitle}|${entry.startDate}|${entry.endDate}`;
    if (!unique.has(key)) unique.set(key, entry);
  });
  return [...unique.values()];
}

function renderWeek() {
  const weekEnd = new Date(selectedWeek);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  weekLabel.textContent = `Du ${formatDate(selectedWeek)} au ${formatDate(weekEnd)}`;
  grid.replaceChildren();

  let count = 0;
  for (let index = 0; index < 7; index += 1) {
    const date = new Date(selectedWeek);
    date.setUTCDate(selectedWeek.getUTCDate() + index);
    const dateKey = formatIsoDate(date);
    const day = createElement("section", "resources-day");
    day.append(createElement("span", "resources-day-number", formatCaseDate(date)));
    const entries = getEntries(dateKey);
    count += entries.length;
    entries.forEach((entry) => {
      const event = createElement("button", "resources-event");
      event.type = "button";
      event.append(createElement("strong", "", entry.resourceName));
      if (entry.cis) {
        event.append(createElement("span", "resources-event-resource", entry.cis));
      }
      if (entry.immatriculation) {
        event.append(createElement("span", "resources-event-resource", entry.immatriculation));
      }
      const tooltip = [
        `Formation : ${entry.trainingTitle}`,
        entry.sessionName ? `Session : ${entry.sessionName}` : "",
        `Lieu : ${entry.location || "non renseigné"}`,
        entry.contact ? `Contact : ${entry.contact}` : "",
        entry.notes ? `Notes : ${entry.notes}` : ""
      ].filter(Boolean).join("\n");
      event.title = tooltip;
      event.setAttribute("aria-label", tooltip.replace(/\n/g, ", "));
      day.append(event);
    });
    grid.append(day);
  }
  summary.textContent = `${count} affectation${count === 1 ? "" : "s"} de ressource${count === 1 ? "" : "s"} sur cette semaine.`;
}

document.querySelector("#public-resource-week-previous").addEventListener("click", () => {
  selectedWeek.setUTCDate(selectedWeek.getUTCDate() - 7);
  renderWeek();
});
document.querySelector("#public-resource-week-next").addEventListener("click", () => {
  selectedWeek.setUTCDate(selectedWeek.getUTCDate() + 7);
  renderWeek();
});
document.querySelector("#public-resource-week-today").addEventListener("click", () => {
  const now = new Date();
  selectedWeek.setTime(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  selectedWeek.setUTCDate(selectedWeek.getUTCDate() - ((selectedWeek.getUTCDay() + 6) % 7));
  renderWeek();
});

loadData();
