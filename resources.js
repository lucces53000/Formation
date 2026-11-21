import { firebaseConfig } from "./firebase-config.js";
import {
  connectFirebaseEmulators,
  getFirebaseConfig
} from "./firebase-environment.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const PRIMARY_MANAGER_EMAIL = "luc.cesbron@sdis53.fr";
const app = initializeApp(getFirebaseConfig(firebaseConfig));
const auth = getAuth(app);
const db = getFirestore(app);
connectFirebaseEmulators({ auth, db });

const loginPanel = document.querySelector("#resources-login-panel");
const accessDeniedPanel = document.querySelector("#resources-access-denied");
const resourcesPanel = document.querySelector("#resources-panel");
const signOutButton = document.querySelector("#resources-sign-out");
const statusElement = document.querySelector("#resources-status");
const monthGrid = document.querySelector("#resources-month-grid");
const agenda = document.querySelector("#resources-agenda");
const monthLabel = document.querySelector("#resources-month-label");
const weekLabel = document.querySelector("#resources-week-label");
const calendarSummary = document.querySelector("#resources-calendar-summary");
const resourceFilter = document.querySelector("#resources-calendar-resource-filter");
const resourceList = document.querySelector("#resource-list");
const managerList = document.querySelector("#resource-manager-list");
const managerTab = document.querySelector("#resource-managers-tab");
const resourceDialog = document.querySelector("#resource-form-dialog");
const resourceForm = document.querySelector("#resource-form");
const assignmentDialog = document.querySelector("#assignment-form-dialog");
const assignmentForm = document.querySelector("#assignment-form");
const managerDialog = document.querySelector("#manager-form-dialog");
const managerForm = document.querySelector("#manager-form");
const assignmentError = document.querySelector("#assignment-error");
const deleteAssignmentButton = document.querySelector("#delete-assignment");

const selectedMonth = new Date();
selectedMonth.setDate(1);
const selectedWeek = new Date();
selectedWeek.setUTCDate(selectedWeek.getUTCDate() - ((selectedWeek.getUTCDay() + 6) % 7));
selectedWeek.setUTCHours(0, 0, 0, 0);
let calendarViewMode = "month";
let currentUser = null;
let isPrimaryManager = false;
let trainings = [];
let resources = [];
let managers = [];
let assignments = [];
let requests = [];
let sessions = [];
let editingResourceId = "";
let editingAssignmentId = "";

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function showStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.classList.toggle("error", isError);
}

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

function formatFrenchDate(value) {
  const date = parseIsoDate(value);
  if (!date) return "Date non renseignée";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function formatDate(date) {
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

function stableSessionId(trainingId, session, kind, phaseIndex, sessionIndex) {
  return `${trainingId}|${kind}|${phaseIndex ?? ""}|${sessionIndex}`;
}

function sessionEntries(training, trainingId) {
  if (training.resourcesEnabled !== true) return [];
  const result = [];
  (Array.isArray(training.sessions) ? training.sessions : []).forEach((session, sessionIndex) => {
    result.push({
      trainingId,
      trainingTitle: training.title || training.id || "Formation sans titre",
      sessionId: stableSessionId(trainingId, session, "direct", null, sessionIndex),
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
        sessionId: stableSessionId(trainingId, session, "phase", phaseIndex, sessionIndex),
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

async function isResourceManager(user) {
  if (!user || !user.emailVerified) return false;
  const email = normalizeEmail(user.email);
  if (email === PRIMARY_MANAGER_EMAIL) return true;
  try {
    const snapshot = await getDoc(doc(db, "resourceManagers", email));
    return snapshot.exists() && snapshot.data().active === true;
  } catch {
    return false;
  }
}

async function initializePage(user) {
  currentUser = user;
  loginPanel.classList.toggle("hidden", Boolean(user));
  signOutButton.classList.toggle("hidden", !user);
  resourcesPanel.classList.add("hidden");
  accessDeniedPanel.classList.add("hidden");

  if (!user) {
    showStatus("");
    return;
  }
  if (!user.emailVerified) {
    accessDeniedPanel.classList.remove("hidden");
    accessDeniedPanel.querySelector("p").textContent =
      "Vérifiez votre adresse e-mail puis reconnectez-vous.";
    showStatus("Adresse e-mail non vérifiée.", true);
    return;
  }

  const authorized = await isResourceManager(user);
  if (!authorized) {
    accessDeniedPanel.classList.remove("hidden");
    showStatus("Accès réservé aux gestionnaires autorisés.", true);
    return;
  }

  isPrimaryManager = normalizeEmail(user.email) === PRIMARY_MANAGER_EMAIL;
  managerTab.classList.toggle("hidden", !isPrimaryManager);
  resourcesPanel.classList.remove("hidden");
  showStatus("Chargement des ressources…");
  await loadData();
}

async function loadData() {
  try {
    const [trainingSnapshot, resourceSnapshot, assignmentSnapshot, requestSnapshot] = await Promise.all([
      getDocs(collection(db, "trainings")),
      getDocs(collection(db, "resources")),
      getDocs(collection(db, "resourceAssignments")),
      getDocs(collection(db, "resourceRequests"))
    ]);
    trainings = trainingSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    resources = resourceSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    assignments = assignmentSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    requests = requestSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    if (isPrimaryManager) {
      const managerSnapshot = await getDocs(collection(db, "resourceManagers"));
      managers = managerSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    } else {
      managers = [];
    }
    sessions = trainings.flatMap((training) => sessionEntries(training, training.id));
    renderResources();
    renderManagers();
    renderRequests();
    renderAssignmentManagement();
    renderResourceFilter();
    renderAssignmentOptions();
    renderCalendar();
    showStatus(`${sessions.length} session${sessions.length === 1 ? "" : "s"} chargée${sessions.length === 1 ? "" : "s"}.`);
  } catch (error) {
    showStatus(`Impossible de charger les données : ${error.message}`, true);
  }
}

function renderResourceFilter() {
  resourceFilter.replaceChildren(new Option("Toutes les ressources", ""));
  resources.forEach((resource) => {
    resourceFilter.append(new Option(resource.name, resource.id));
  });
  if (!resources.some((resource) => resource.id === resourceFilter.value)) {
    resourceFilter.value = "";
  }
}

function renderResources() {
  resourceList.replaceChildren();
  if (resources.length === 0) {
    resourceList.append(createElement("p", "", "Aucune ressource enregistrée."));
    return;
  }
  [...resources].sort((left, right) => String(left.name).localeCompare(String(right.name), "fr"))
    .forEach((resource) => {
      const card = createElement("article", "resource-card");
      const heading = createElement("div", "resource-card-heading");
      const title = createElement("h3", "", resource.name);
      const status = createElement("span",
        `resource-status${resource.active === false ? " inactive" : ""}`,
        resource.active === false ? "Inactive" : "Active");
      heading.append(title, status);
      card.append(
        heading,
        createElement("p", "", `Type : ${resourceTypeLabel(resource.type)}`),
        createElement("p", "", `CIS propriétaire : ${resource.cis || "—"}`),
        createElement("p", "", `Immatriculation : ${resource.immatriculation || "—"}`),
        createElement("p", "", resource.notes || "")
      );
      const actions = createElement("div", "resource-card-actions");
      const editButton = createElement("button", "button secondary", "Modifier");
      editButton.type = "button";
      editButton.addEventListener("click", () => openResourceDialog(resource));
      const deleteButton = createElement("button", "button danger", "Supprimer");
      deleteButton.type = "button";
      deleteButton.addEventListener("click", () => deleteResource(resource));
      actions.append(editButton, deleteButton);
      card.append(actions);
      resourceList.append(card);
    });
}

function resourceTypeLabel(type) {
  return {
    vehicule: "Véhicule",
    salle: "Salle",
    materiel: "Matériel",
    formateur: "Formateur",
    autre: "Autre"
  }[type] || type || "Autre";
}

let resolvingRequestId = "";
const resolvedAssignedResourceIds = new Set();

function renderAssignmentManagement() {
  const list = document.querySelector("#assignment-management-list");
  list.replaceChildren();
  const activeAssignments = assignments.filter((assignment) => assignment.status !== "cancelled")
    .sort((left, right) => String(left.startDate).localeCompare(String(right.startDate), "fr"));
  if (activeAssignments.length === 0) {
    list.append(createElement("p", "", "Aucune affectation enregistrée."));
    return;
  }
  activeAssignments.forEach((assignment) => {
    const session = sessions.find((item) => item.sessionId === assignment.sessionId);
    const names = assignmentResourceIds(assignment).map((resourceId) =>
      resources.find((resource) => resource.id === resourceId)?.name
    ).filter(Boolean);
    if (assignment.temporaryResource) {
      const temporaryResources = Array.isArray(assignment.temporaryResources)
        ? assignment.temporaryResources
        : [{
          name: assignment.temporaryName || "Véhicule ponctuel",
          registration: assignment.temporaryRegistration || ""
        }];
      temporaryResources.forEach((temporary) =>
        names.push(`${temporary.name || "Véhicule ponctuel"}${temporary.registration ? ` — ${temporary.registration}` : ""}`)
      );
    }
    const card = createElement("article", "resource-card");
    card.append(
      createElement("h3", "", session?.trainingTitle || "Formation"),
      createElement("p", "", `Session : ${session?.sessionName || "Session"}`),
      createElement("p", "", `Dates : du ${assignment.startDate} au ${assignment.endDate || assignment.startDate}`),
      createElement("p", "", `Ressources : ${names.join(", ") || "—"}`),
      createElement("p", "", `Contact : ${assignment.contact || "—"}`),
      createElement("p", "", `Notes : ${assignment.notes || "—"}`)
    );
    const actions = createElement("div", "resource-card-actions");
    const editButton = createElement("button", "button secondary", "Modifier");
    editButton.type = "button";
    editButton.addEventListener("click", () => openAssignmentDialog(assignment));
    const deleteButton = createElement("button", "button danger", "Supprimer");
    deleteButton.type = "button";
    deleteButton.addEventListener("click", () => deleteAssignmentFromManagement(assignment));
    actions.append(editButton, deleteButton);
    card.append(actions);
    list.append(card);
  });
}

async function deleteAssignmentFromManagement(assignment) {
  if (!window.confirm("Supprimer définitivement cette affectation ?")) return;
  try {
    await deleteDoc(doc(db, "resourceAssignments", assignment.id));
    showStatus("Affectation supprimée.");
    await loadData();
  } catch (error) {
    showStatus(`Impossible de supprimer l’affectation : ${error.message}`, true);
  }
}

function renderRequests() {
  const list = document.querySelector("#resource-request-list");
  list.replaceChildren();
  const pending = requests.filter((item) => item.status === "pending")
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  if (pending.length === 0) {
    list.append(createElement("p", "", "Aucune demande en attente."));
    return;
  }
  pending.forEach((request) => {
    const training = trainings.find((item) => item.id === request.trainingId);
    const registeredNames = (request.resourceIds || []).map((resourceId) =>
      resources.find((resource) => resource.id === resourceId)?.name
    ).filter(Boolean);
    const temporaryNames = (request.temporaryResources || []).map((item) =>
      item.registration
        ? `${item.name || "Véhicule ponctuel"} — ${item.registration}`
        : item.name || "Véhicule ponctuel"
    );
    const card = createElement("article", "resource-card");
    card.append(
      createElement("h3", "", training?.title || "Formation"),
      createElement("p", "", `Demandeur : ${request.requesterEmail || "Non renseigné"}`),
      createElement("p", "", `Dates : du ${formatFrenchDate(request.startDate)} au ${formatFrenchDate(request.endDate)}`),
      createElement("p", "", `Ressources demandées : ${[...registeredNames, ...temporaryNames].join(", ") || "—"}`),
      createElement("p", "", `Notes : ${request.notes || "—"}`)
    );
    const actions = createElement("div", "resource-card-actions");
    const processButton = createElement("button", "button primary", "Traiter");
    processButton.type = "button";
    processButton.addEventListener("click", () => openRequestResolveDialog(request));
    actions.append(processButton);
    card.append(actions);
    list.append(card);
  });
}

function openRequestResolveDialog(request) {
  resolvingRequestId = request.id;
  const dialog = document.querySelector("#request-resolve-dialog");
  const form = document.querySelector("#request-resolve-form");
  form.elements.namedItem("decision").value = "accepted";
  resolvedAssignedResourceIds.clear();
  (request.resourceIds || []).forEach((resourceId) => resolvedAssignedResourceIds.add(resourceId));
  const cards = document.querySelector("#request-assigned-resource-cards");
  cards.replaceChildren();
  resources.filter((resource) => resource.active !== false).forEach((resource) => {
    const card = createElement("button",
      `resource-select-card${resolvedAssignedResourceIds.has(resource.id) ? " selected" : ""}`);
    card.type = "button";
    card.append(
      createElement("strong", "", resource.name),
      createElement("span", "", `${resource.cis}${resource.immatriculation ? ` — ${resource.immatriculation}` : ""}`)
    );
    card.setAttribute("aria-pressed", String(resolvedAssignedResourceIds.has(resource.id)));
    card.addEventListener("click", () => {
      if (resolvedAssignedResourceIds.has(resource.id)) resolvedAssignedResourceIds.delete(resource.id);
      else resolvedAssignedResourceIds.add(resource.id);
      card.classList.toggle("selected", resolvedAssignedResourceIds.has(resource.id));
      card.setAttribute("aria-pressed", String(resolvedAssignedResourceIds.has(resource.id)));
    });
    cards.append(card);
  });
  const temporaryList = document.querySelector("#request-assigned-temporary-list");
  temporaryList.replaceChildren();
  (request.temporaryResources || []).forEach((resource) => {
    createAssignedTemporaryResourceRow(resource);
  });
  dialog.showModal();
}

function renderManagers() {
  managerList.replaceChildren();
  if (!isPrimaryManager) return;
  if (managers.length === 0) {
    managerList.append(createElement("p", "", "Aucun gestionnaire enregistré."));
  }
  managers.sort((left, right) => String(left.email).localeCompare(String(right.email), "fr"))
    .forEach((manager) => {
      const card = createElement("article", "resource-manager-card");
      const heading = createElement("div", "resource-manager-heading");
      heading.append(
        createElement("h3", "", manager.displayName || manager.email),
        createElement("span",
          `manager-status${manager.active === false ? " inactive" : ""}`,
          manager.active === false ? "Désactivé" : "Actif")
      );
      card.append(heading, createElement("p", "", manager.email));
      if (normalizeEmail(manager.email) !== PRIMARY_MANAGER_EMAIL) {
        const actions = createElement("div", "resource-manager-actions");
        const toggleButton = createElement("button", "button secondary",
          manager.active === false ? "Activer" : "Désactiver");
        toggleButton.type = "button";
        toggleButton.addEventListener("click", () => toggleManager(manager));
        actions.append(toggleButton);
        card.append(actions);
      }
      managerList.append(card);
    });
}

function renderAssignmentOptions() {
  const sessionSelect = assignmentForm.elements.namedItem("sessionId");
  sessionSelect.replaceChildren(new Option("Sélectionner une session", ""));
  [...sessions].filter((session) => session.startDate && !session.cancelled)
    .sort((left, right) =>
      String(left.startDate).localeCompare(String(right.startDate), "fr")
      || String(left.trainingTitle).localeCompare(String(right.trainingTitle), "fr"))
    .forEach((session) => {
      sessionSelect.append(new Option(
        `${session.trainingTitle} — ${formatDateRange(session.startDate, session.endDate)}${session.sessionName ? ` — ${session.sessionName}` : ""}${session.location ? ` — ${session.location}` : ""}`,
        session.sessionId
      ));
    });
  const resourceCards = document.querySelector("#assignment-resource-cards");
  if (!resourceCards) return;
  resourceCards.replaceChildren();
  const selectedIds = new Set(editingAssignmentId
    ? assignmentResourceIds(assignments.find((item) => item.id === editingAssignmentId) || {})
    : []);
  resources.filter((resource) => resource.active !== false)
    .sort((left, right) => String(left.name).localeCompare(String(right.name), "fr"))
    .forEach((resource) => {
      const card = createElement("button",
        `resource-select-card${selectedIds.has(resource.id) ? " selected" : ""}`);
      card.type = "button";
      card.dataset.resourceId = resource.id;
      card.append(
        createElement("strong", "", resource.name),
        createElement("span", "", `${resource.cis || "CIS non renseigné"}${resource.immatriculation ? ` — ${resource.immatriculation}` : ""}`)
      );
      card.setAttribute("aria-pressed", String(selectedIds.has(resource.id)));
      card.addEventListener("click", () => {
        if (selectedIds.has(resource.id)) selectedIds.delete(resource.id);
        else selectedIds.add(resource.id);
        card.classList.toggle("selected", selectedIds.has(resource.id));
        card.setAttribute("aria-pressed", String(selectedIds.has(resource.id)));
      });
      resourceCards.append(card);
    });
}

function renderWeekCalendar() {
  monthGrid.hidden = false;
  agenda.hidden = false;
  agenda.replaceChildren();
  monthGrid.replaceChildren();

  ["Lun.", "Mar.", "Mer.", "Jeu.", "Ven.", "Sam.", "Dim."]
    .forEach((name) => monthGrid.append(createElement("div", "resources-weekday", name)));

  const weekEnd = new Date(selectedWeek);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  weekLabel.textContent = `Du ${formatDate(selectedWeek)} au ${formatDate(weekEnd)}`;

  let affectedResourceCount = 0;
  for (let index = 0; index < 7; index += 1) {
    const date = new Date(selectedWeek);
    date.setUTCDate(selectedWeek.getUTCDate() + index);
    const dateKey = formatIsoDate(date);
    const day = createElement("section", "resources-day");
    day.append(createElement("span", "resources-day-number", formatDate(date)));
    const resourceEntries = getWeekResourceEntries(dateKey);
    affectedResourceCount += resourceEntries.length;
    resourceEntries.forEach((entry) => {
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
        entry.location ? `Lieu : ${entry.location}` : "Lieu : non renseigné",
        entry.contact ? `Contact : ${entry.contact}` : "",
        entry.notes ? `Notes : ${entry.notes}` : ""
      ].filter(Boolean).join("\n");
      event.title = tooltip;
      event.setAttribute("aria-label", tooltip.replace(/\n/g, ", "));
      event.addEventListener("click", () => openAssignmentDialog(entry.assignment));
      day.append(event);
    });
    monthGrid.append(day);
  }
  calendarSummary.textContent = `${affectedResourceCount} affectation${affectedResourceCount === 1 ? "" : "s"} de ressource${affectedResourceCount === 1 ? "" : "s"} sur cette semaine.`;
}

function getWeekResourceEntries(dateKey) {
  const filterId = resourceFilter.value;
  const entries = [];
  assignments.filter((assignment) =>
    assignment.status !== "cancelled" &&
    assignment.startDate <= dateKey &&
    (assignment.endDate || assignment.startDate) >= dateKey
  ).forEach((assignment) => {
    const session = sessions.find((item) => item.sessionId === assignment.sessionId);
    const addEntry = (resourceName, immatriculation, cis, resourceId) => {
      if (filterId && resourceId !== filterId) return;
      entries.push({
        resourceName,
        immatriculation,
        cis,
        contact: assignment.contact || "",
        notes: assignment.notes || "",
        resourceId,
        assignment,
        trainingTitle: session?.trainingTitle || "Formation inconnue",
        sessionName: session?.sessionName || "",
        location: session?.location || "",
        startDate: assignment.startDate,
        endDate: assignment.endDate || assignment.startDate
      });
    };
    assignmentResourceIds(assignment).forEach((resourceId) => {
      const resource = resources.find((item) => item.id === resourceId);
      if (resource) addEntry(resource.name, resource.immatriculation || "", resource.cis || "", resourceId);
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
        addEntry(
          temporary.name || "Véhicule ponctuel",
          temporary.registration || "",
          temporary.cis || "",
          ""
        );
      });
    }
  });

  const unique = new Map();
  entries.forEach((entry) => {
    const key = `${entry.resourceName}|${entry.immatriculation}|${entry.assignment.id}`;
    if (!unique.has(key)) unique.set(key, entry);
  });
  return [...unique.values()];
}

function renderCalendar() {
  if (calendarViewMode === "week") {
    renderWeekCalendar();
    return;
  }
  const year = selectedMonth.getUTCFullYear();
  const month = selectedMonth.getUTCMonth();
  monthLabel.textContent = new Intl.DateTimeFormat("fr-FR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(selectedMonth);

  const first = new Date(Date.UTC(year, month, 1));
  const gridStart = new Date(first);
  const mondayOffset = (first.getUTCDay() + 6) % 7;
  gridStart.setUTCDate(first.getUTCDate() - mondayOffset);
  monthGrid.replaceChildren();
  ["Lun.", "Mar.", "Mer.", "Jeu.", "Ven.", "Sam.", "Dim."]
    .forEach((name) => monthGrid.append(createElement("div", "resources-weekday", name)));

  const todayKey = formatIsoDate(new Date(Date.UTC(
    new Date().getFullYear(),
    new Date().getMonth(),
    new Date().getDate()
  )));
  const filterId = resourceFilter.value;
  let matchingAssignmentCount = 0;
  agenda.replaceChildren();

  for (let index = 0; index < 42; index += 1) {
    const date = new Date(gridStart);
    date.setUTCDate(gridStart.getUTCDate() + index);
    const dateKey = formatIsoDate(date);
    const day = createElement("section", "resources-day");
    if (date.getUTCMonth() !== month) day.classList.add("is-outside");
    if (dateKey === todayKey) day.classList.add("is-today");
    day.append(createElement("span", "resources-day-number", String(date.getUTCDate())));

    const dayItems = getDayItems(dateKey, filterId);
    matchingAssignmentCount += dayItems.assignments.length;
    dayItems.sessions.forEach((item) => day.append(createCalendarEvent(item, dateKey)));
    monthGrid.append(day);
  }

  for (let index = 0; index < 42; index += 1) {
    const date = new Date(gridStart);
    date.setUTCDate(gridStart.getUTCDate() + index);
    if (date.getUTCMonth() !== month) continue;
    const dateKey = formatIsoDate(date);
    const dayItems = getDayItems(dateKey, filterId);
    if (dayItems.sessions.length === 0) continue;
    const dayBlock = createElement("section", "resources-agenda-day");
    dayBlock.append(createElement("h4", "", formatDate(date)));
    dayItems.sessions.forEach((item) => dayBlock.append(createCalendarEvent(item, dateKey)));
    agenda.append(dayBlock);
  }

  calendarSummary.textContent = `${daySessionCount(filterId)} session${daySessionCount(filterId) === 1 ? "" : "s"} datée${daySessionCount(filterId) === 1 ? "" : "s"} dans ce mois ; ${matchingAssignmentCount} affectation${matchingAssignmentCount === 1 ? "" : "s"} affichée${matchingAssignmentCount === 1 ? "" : "s"}.`;
}

function daySessionCount(filterId) {
  const year = selectedMonth.getUTCFullYear();
  const month = selectedMonth.getUTCMonth();
  const monthStart = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const monthEnd = formatIsoDate(new Date(Date.UTC(year, month + 1, 0)));
  return sessions.filter((session) =>
    session.startDate &&
    session.startDate <= monthEnd &&
    session.endDate >= monthStart &&
    (!filterId || assignments.some((assignment) =>
      assignment.sessionId === session.sessionId &&
      assignmentResourceIds(assignment).includes(filterId) &&
      assignment.status !== "cancelled"))
  ).length;
}

function getDayItems(dateKey, filterId) {
  const matchingSessions = sessions.filter((session) =>
    session.startDate &&
    session.startDate <= dateKey &&
    session.endDate >= dateKey
  );
  const matchingAssignments = assignments.filter((assignment) =>
    assignment.status !== "cancelled" &&
    assignment.startDate <= dateKey &&
    (assignment.endDate || assignment.startDate) >= dateKey &&
    (!filterId || assignmentResourceIds(assignment).includes(filterId))
  );
  return { sessions: matchingSessions, assignments: matchingAssignments };
}

function createCalendarEvent(session, dateKey) {
  const sessionAssignments = assignments.filter((assignment) =>
    assignment.sessionId === session.sessionId &&
    assignment.status !== "cancelled" &&
    assignment.startDate <= dateKey &&
    (assignment.endDate || assignment.startDate) >= dateKey &&
    (!resourceFilter.value || assignmentResourceIds(assignment).includes(resourceFilter.value))
  );
  const button = createElement("button", `resources-event${session.cancelled ? " is-cancelled" : ""}`);
  button.type = "button";
  button.append(createElement("strong", "", session.trainingTitle));
  if (session.sessionName) button.append(createElement("span", "", session.sessionName));
  if (session.location) button.append(createElement("span", "resources-event-resource", session.location));
  if (sessionAssignments.length > 0) {
    const names = sessionAssignments.map((assignment) => {
      const names = assignmentResourceIds(assignment).map((resourceId) =>
        resources.find((item) => item.id === resourceId)?.name
      ).filter(Boolean);
      if (assignment.temporaryResource) {
        const temporaryResources = Array.isArray(assignment.temporaryResources)
          ? assignment.temporaryResources
          : [{
            name: assignment.temporaryName || "Véhicule ponctuel",
            registration: assignment.temporaryRegistration || ""
          }];
        temporaryResources.forEach((temporary) => {
          names.push(`${temporary.name || "Véhicule ponctuel"}${temporary.registration ? ` — ${temporary.registration}` : ""}`);
        });
      }
      const name = names.length > 0
        ? names.join(" ; ")
        : (assignment.temporaryResource
        ? `${assignment.temporaryName || "Véhicule ponctuel"}${assignment.temporaryRegistration ? ` — ${assignment.temporaryRegistration}` : ""}`
        : "Ressource");
      return `${name}${assignment.status === "confirmed" ? " (confirmée)" : " (prévue)"}`;
    });
    button.append(createElement("span", "resources-event-resource", names.join(" ; ")));
  } else {
    button.append(createElement("span", "resources-event-resource", "Aucune ressource"));
  }
  button.addEventListener("click", () => {
    if (sessionAssignments.length === 1) openAssignmentDialog(sessionAssignments[0]);
    else openAssignmentDialog(null, session);
  });
  return button;
}

function openResourceDialog(resource = null) {
  editingResourceId = resource?.id || "";
  document.querySelector("#resource-form-title").textContent =
    resource ? "Modifier la ressource" : "Ajouter une ressource";
  resourceForm.elements.namedItem("name").value = resource?.name || "";
  resourceForm.elements.namedItem("type").value = resource?.type || "vehicule";
  resourceForm.elements.namedItem("immatriculation").value = resource?.immatriculation || "";
  resourceForm.elements.namedItem("cis").value = resource?.cis || "";
  resourceForm.elements.namedItem("active").checked = resource ? resource.active !== false : true;
  resourceForm.elements.namedItem("notes").value = resource?.notes || "";
  resourceDialog.showModal();
}

async function saveResource(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = {
    name: form.elements.namedItem("name").value.trim(),
    type: form.elements.namedItem("type").value,
    immatriculation: form.elements.namedItem("immatriculation").value.trim(),
    cis: form.elements.namedItem("cis").value.trim(),
    active: form.elements.namedItem("active").checked,
    notes: form.elements.namedItem("notes").value.trim(),
    updatedBy: normalizeEmail(currentUser.email),
    updatedAt: serverTimestamp()
  };
  if (!data.name || !data.cis) {
    showStatus("Renseignez un nom de véhicule et son CIS propriétaire.", true);
    return;
  }
  try {
    if (editingResourceId) {
      await updateDoc(doc(db, "resources", editingResourceId), data);
      showStatus("Ressource modifiée.");
    } else {
      await addDoc(collection(db, "resources"), {
        ...data,
        createdBy: normalizeEmail(currentUser.email),
        createdAt: serverTimestamp()
      });
      showStatus("Ressource ajoutée.");
    }
    resourceDialog.close();
    await loadData();
  } catch (error) {
    showStatus(`Impossible d’enregistrer la ressource : ${error.message}`, true);
  }
}

async function deleteResource(resource) {
  const linked = assignments.some((assignment) =>
    assignmentResourceIds(assignment).includes(resource.id) && assignment.status !== "cancelled");
  if (linked) {
    showStatus("Impossible de supprimer une ressource ayant une affectation active.", true);
    return;
  }
  if (!window.confirm(`Supprimer la ressource « ${resource.name} » ?`)) return;
  try {
    await deleteDoc(doc(db, "resources", resource.id));
    showStatus("Ressource supprimée.");
    await loadData();
  } catch (error) {
    showStatus(`Impossible de supprimer la ressource : ${error.message}`, true);
  }
}

function createTemporaryResourceRow(resource = {}) {
  const row = createElement("div", "temporary-resource-row");
  const nameLabel = createElement("label", "", "Véhicule");
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.maxLength = 100;
  nameInput.dataset.temporaryName = "";
  nameInput.value = resource.name || "";
  nameLabel.append(nameInput);

  const registrationLabel = createElement("label", "", "Immatriculation (facultative)");
  const registrationInput = document.createElement("input");
  registrationInput.type = "text";
  registrationInput.maxLength = 100;
  registrationInput.dataset.temporaryRegistration = "";
  registrationInput.value = resource.registration || "";
  registrationLabel.append(registrationInput);

  const cisLabel = createElement("label", "", "CIS propriétaire");
  const cisInput = document.createElement("input");
  cisInput.type = "text";
  cisInput.maxLength = 100;
  cisInput.dataset.temporaryCis = "";
  cisInput.value = resource.cis || "";
  cisLabel.append(cisInput);

  const remove = createElement("button", "button danger", "Retirer");
  remove.type = "button";
  remove.addEventListener("click", () => row.remove());
  row.append(nameLabel, registrationLabel, cisLabel, remove);
  document.querySelector("#temporary-resource-list").append(row);
}

function resetTemporaryResourceRows(assignment = null) {
  const list = document.querySelector("#temporary-resource-list");
  list.replaceChildren();
  const resources = Array.isArray(assignment?.temporaryResources)
    ? assignment.temporaryResources
    : (assignment?.temporaryResource
      ? [{
        name: assignment.temporaryName || "",
        registration: assignment.temporaryRegistration || "",
        cis: assignment.temporaryCis || ""
      }]
      : []);
  if (resources.length > 0) {
    resources.forEach((resource) => createTemporaryResourceRow(resource));
  } else {
    createTemporaryResourceRow();
  }
  document.querySelectorAll(".temporary-resource-row").forEach((row) => {
    row.querySelector("[data-temporary-name]").required = false;
    row.querySelector("[data-temporary-cis]").required = false;
  });
}

function createAssignedTemporaryResourceRow(resource = {}) {
  const row = createElement("div", "temporary-resource-row");
  const nameLabel = createElement("label", "", "Véhicule");
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.maxLength = 100;
  nameInput.dataset.assignedTemporaryName = "";
  nameInput.value = resource.name || "";
  nameLabel.append(nameInput);
  const registrationLabel = createElement("label", "", "Immatriculation (facultative)");
  const registrationInput = document.createElement("input");
  registrationInput.type = "text";
  registrationInput.maxLength = 100;
  registrationInput.dataset.assignedTemporaryRegistration = "";
  registrationInput.value = resource.registration || "";
  registrationLabel.append(registrationInput);
  const cisLabel = createElement("label", "", "CIS propriétaire");
  const cisInput = document.createElement("input");
  cisInput.type = "text";
  cisInput.maxLength = 100;
  cisInput.dataset.assignedTemporaryCis = "";
  cisInput.value = resource.cis || "";
  cisLabel.append(cisInput);
  const remove = createElement("button", "button danger", "Retirer");
  remove.type = "button";
  remove.addEventListener("click", () => row.remove());
  row.append(nameLabel, registrationLabel, cisLabel, remove);
  document.querySelector("#request-assigned-temporary-list").append(row);
}

function openAssignmentDialog(assignment = null, session = null) {
  editingAssignmentId = assignment?.id || "";
  document.querySelector("#assignment-form-title").textContent =
    assignment ? "Modifier l’affectation" : "Ajouter une affectation";
  deleteAssignmentButton.classList.toggle("hidden", !assignment);
  assignmentError.textContent = "";
  assignmentForm.elements.namedItem("sessionId").value =
    assignment?.sessionId || session?.sessionId || "";
  const temporary = Boolean(assignment?.temporaryResource);
  assignmentForm.elements.namedItem("temporaryResource").checked =
    temporary || (!assignment && false);
  resetTemporaryResourceRows(assignment);
  updateTemporaryResourceFields();
  renderAssignmentOptions();
  assignmentForm.elements.namedItem("startDate").value =
    assignment?.startDate || session?.startDate || "";
  assignmentForm.elements.namedItem("endDate").value =
    assignment?.endDate || session?.endDate || session?.startDate || "";
  assignmentForm.elements.namedItem("status").value =
    assignment?.status || "planned";
  assignmentForm.elements.namedItem("notes").value =
    assignment?.notes || "";
  assignmentDialog.showModal();
}

function assignmentResourceIds(assignment) {
  if (Array.isArray(assignment.resourceIds)) return assignment.resourceIds;
  return assignment.resourceId ? [assignment.resourceId] : [];
}

function assignmentOverlap(left, right) {
  const leftEnd = left.endDate || left.startDate;
  const rightEnd = right.endDate || right.startDate;
  return left.startDate <= rightEnd && right.startDate <= leftEnd;
}

function normalizedRegistration(value) {
  return String(value || "").trim().replace(/[\s-]/g, "").toUpperCase();
}

function updateTemporaryResourceFields() {
  const enabled = assignmentForm.elements.namedItem("temporaryResource").checked;
  document.querySelector("#temporary-resource-fields").classList.toggle("hidden", !enabled);
  document.querySelectorAll(".temporary-resource-row").forEach((row) => {
    row.querySelector("[data-temporary-name]").required = enabled;
    row.querySelector("[data-temporary-cis]").required = enabled;
  });
}

function findConflict(data) {
  if (data.temporaryResource) {
    if (data.temporaryResources.length === 0 ||
      data.temporaryResources.some((resource) => !resource.name || !resource.cis)) {
      return "Renseignez chaque véhicule ponctuel et son CIS.";
    }
  }
  if (data.endDate < data.startDate) {
    return "La date de fin ne peut pas précéder la date de début.";
  }
  const session = sessions.find((item) => item.sessionId === data.sessionId);
  if (!session || session.cancelled) {
    return "La session est inexistante ou annulée.";
  }
  if (data.startDate < session.startDate || data.endDate > (session.endDate || session.startDate)) {
    return "Les dates doivent rester incluses dans les dates de la session.";
  }
  if (data.status === "cancelled") return "";

  if (!data.temporaryResource && data.resourceIds.length === 0) {
    return "Sélectionnez au moins une ressource ou utilisez une ressource ponctuelle.";
  }

  const conflictDescriptions = [];
  const checkedResources = data.resourceIds.map((resourceId) => {
    const resource = resources.find((item) => item.id === resourceId);
    if (!resource || resource.active === false) {
      conflictDescriptions.push("Une ressource sélectionnée est inexistante ou inactive.");
      return null;
    }
    return resource;
  }).filter(Boolean);

  const checkResourceConflict = (label, matchesExisting) => {
    const overlapping = assignments.filter((item) =>
      item.id !== editingAssignmentId &&
      item.status !== "cancelled" &&
      assignmentOverlap(data, item) &&
      matchesExisting(item)
    );
    if (overlapping.length > 0) {
      const details = overlapping.map((item) => {
        const reservedSession = sessions.find((entry) => entry.sessionId === item.sessionId);
        const title = reservedSession?.trainingTitle || "Formation inconnue";
        const sessionName = reservedSession?.sessionName ? ` — ${reservedSession.sessionName}` : "";
        return `${title}${sessionName}, du ${formatDateRange(item.startDate, item.endDate)}`;
      });
      conflictDescriptions.push(`${label} déjà réservé(e) pour ${details.join(" ; ")}.`);
    }
  };

  checkedResources.forEach((resource) => {
    checkResourceConflict(
      resource.name,
      (item) => assignmentResourceIds(item).includes(resource.id)
    );
  });
  if (data.temporaryResource) {
    data.temporaryResources.forEach((temporary) => {
      const registration = normalizedRegistration(temporary.registration);
      if (!registration) return;
      checkResourceConflict(
        `${temporary.name}${temporary.registration ? ` (${temporary.registration})` : ""}`,
        (item) => {
          if (item.resourceIds?.length || item.resourceId) {
            return assignmentResourceIds(item).some((resourceId) => {
              const resource = resources.find((entry) => entry.id === resourceId);
              return normalizedRegistration(resource?.immatriculation) === registration;
            });
          }
          if (Array.isArray(item.temporaryResources)) {
            return item.temporaryResources.some((entry) =>
              normalizedRegistration(entry.registration) === registration
            );
          }
          return normalizedRegistration(item.temporaryRegistration) === registration;
        }
      );
    });
  }
  if (conflictDescriptions.length > 0) {
    return `Conflit de disponibilité : ${conflictDescriptions.join(" ")}`;
  }
  return "";
}

async function saveAssignment(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const selectedIds = [...document.querySelectorAll(
    "#assignment-resource-cards .resource-select-card.selected"
  )].map((card) => card.dataset.resourceId);
  const data = {
    sessionId: form.elements.namedItem("sessionId").value,
    resourceIds: selectedIds,
    startDate: form.elements.namedItem("startDate").value,
    endDate: form.elements.namedItem("endDate").value,
    status: form.elements.namedItem("status").value,
    notes: form.elements.namedItem("notes").value.trim(),
  };
  data.temporaryResource = form.elements.namedItem("temporaryResource").checked;
  if (data.temporaryResource) {
    data.temporaryResources = [...document.querySelectorAll(".temporary-resource-row")].map((row) => ({
      name: row.querySelector("[data-temporary-name]").value.trim(),
      registration: row.querySelector("[data-temporary-registration]").value.trim(),
      cis: row.querySelector("[data-temporary-cis]").value.trim()
    }));
    const first = data.temporaryResources[0] || {};
    data.temporaryName = first.name || "";
    data.temporaryRegistration = first.registration || "";
    data.temporaryCis = first.cis || "";
  } else {
    data.temporaryResources = [];
    data.temporaryName = "";
    data.temporaryRegistration = "";
    data.temporaryCis = "";
  }
  const session = sessions.find((item) => item.sessionId === data.sessionId);
  if (!session) {
    assignmentError.textContent = "Sélectionnez une session.";
    return;
  }
  data.trainingId = session.trainingId;
  data.updatedBy = normalizeEmail(currentUser.email);
  data.updatedAt = serverTimestamp();

  const conflict = findConflict(data);
  if (conflict) {
    assignmentError.textContent = conflict;
    return;
  }

  try {
    let assignmentId = editingAssignmentId;
    if (assignmentId) {
      await updateDoc(doc(db, "resourceAssignments", assignmentId), data);
    } else {
      const reference = await addDoc(collection(db, "resourceAssignments"), {
        ...data,
        createdBy: normalizeEmail(currentUser.email),
        createdAt: serverTimestamp()
      });
      assignmentId = reference.id;
    }
    assignmentDialog.close();
    showStatus(editingAssignmentId ? "Affectation modifiée." : "Affectation ajoutée.");
    try {
      await addDoc(collection(db, "resourceAssignmentHistory"), {
        assignmentId,
        action: editingAssignmentId
          ? (data.status === "cancelled" ? "cancelled" : "updated")
          : "created",
        snapshot: data,
        performedBy: normalizeEmail(currentUser.email),
        performedAt: serverTimestamp()
      });
    } catch (historyError) {
      console.warn("Affectation enregistrée mais historique indisponible :", historyError);
    }
    await loadData();
  } catch (error) {
    assignmentError.textContent = `Impossible d’enregistrer l’affectation : ${error.message}`;
  }
}

async function deleteAssignment() {
  if (!editingAssignmentId) return;
  const assignment = assignments.find((item) => item.id === editingAssignmentId);
  if (!assignment) return;
  if (!window.confirm("Supprimer définitivement cette affectation ?")) return;
  try {
    await deleteDoc(doc(db, "resourceAssignments", editingAssignmentId));
    assignmentDialog.close();
    showStatus("Affectation supprimée.");
    try {
      await addDoc(collection(db, "resourceAssignmentHistory"), {
        assignmentId: editingAssignmentId,
        action: "deleted",
        snapshot: assignment,
        performedBy: normalizeEmail(currentUser.email),
        performedAt: serverTimestamp()
      });
    } catch (historyError) {
      console.warn("Affectation supprimée mais historique indisponible :", historyError);
    }
    await loadData();
  } catch (error) {
    assignmentError.textContent = `Impossible de supprimer l’affectation : ${error.message}`;
  }
}

async function saveManager(event) {
  event.preventDefault();
  if (!isPrimaryManager) return;
  const form = event.currentTarget;
  const email = normalizeEmail(form.elements.namedItem("email").value);
  const displayName = form.elements.namedItem("displayName").value.trim();
  if (!email || !displayName) return;
  try {
    await setDoc(doc(db, "resourceManagers", email), {
      email,
      displayName,
      active: form.elements.namedItem("active").checked,
      createdBy: PRIMARY_MANAGER_EMAIL,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
    managerDialog.close();
    form.reset();
    form.elements.namedItem("active").checked = true;
    showStatus("Gestionnaire enregistré.");
    await loadData();
  } catch (error) {
    showStatus(`Impossible d’enregistrer le gestionnaire : ${error.message}`, true);
  }
}

async function toggleManager(manager) {
  if (!isPrimaryManager) return;
  try {
    await updateDoc(doc(db, "resourceManagers", manager.id), {
      active: manager.active === false,
      updatedBy: PRIMARY_MANAGER_EMAIL,
      updatedAt: serverTimestamp()
    });
    showStatus(manager.active === false ? "Gestionnaire activé." : "Gestionnaire désactivé.");
    await loadData();
  } catch (error) {
    showStatus(`Impossible de modifier le gestionnaire : ${error.message}`, true);
  }
}

document.querySelector("#resources-login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await signInWithEmailAndPassword(
      auth,
      normalizeEmail(form.elements.namedItem("email").value),
      form.elements.namedItem("password").value
    );
  } catch (error) {
    showStatus(`Connexion impossible : ${error.message}`, true);
  }
});

signOutButton.addEventListener("click", async () => {
  await signOut(auth);
});

document.querySelectorAll("[data-resource-tab]").forEach((tab) => {
  tab.addEventListener("click", () => {
    const viewName = tab.dataset.resourceTab;
    document.querySelectorAll("[data-resource-tab]").forEach((item) => {
      const active = item === tab;
      item.classList.toggle("active", active);
      item.setAttribute("aria-selected", String(active));
    });
    document.querySelectorAll("[data-resource-view]").forEach((view) => {
      view.classList.toggle("hidden", view.dataset.resourceView !== viewName);
    });
  });
});

document.querySelector("#resources-month-previous").addEventListener("click", () => {
  selectedMonth.setUTCMonth(selectedMonth.getUTCMonth() - 1);
  renderCalendar();
});
document.querySelector("#resources-month-next").addEventListener("click", () => {
  selectedMonth.setUTCMonth(selectedMonth.getUTCMonth() + 1);
  renderCalendar();
});
document.querySelector("#resources-month-today").addEventListener("click", () => {
  const now = new Date();
  selectedMonth.setUTCFullYear(now.getFullYear(), now.getMonth(), 1);
  renderCalendar();
});
resourceFilter.addEventListener("change", renderCalendar);

document.querySelector("#open-resource-create").addEventListener("click", () => openResourceDialog());
document.querySelector("#close-resource-dialog").addEventListener("click", () => resourceDialog.close());
document.querySelector("#cancel-resource-edit").addEventListener("click", () => resourceDialog.close());
resourceForm.addEventListener("submit", saveResource);

document.querySelector("#open-assignment-create").addEventListener("click", () => openAssignmentDialog());
document.querySelector("#close-assignment-dialog").addEventListener("click", () => assignmentDialog.close());
document.querySelector("#cancel-assignment-edit").addEventListener("click", () => assignmentDialog.close());
deleteAssignmentButton.addEventListener("click", deleteAssignment);
assignmentForm.addEventListener("submit", saveAssignment);
assignmentForm.elements.namedItem("temporaryResource").addEventListener("change", updateTemporaryResourceFields);
document.querySelector("#add-temporary-resource").addEventListener("click", () => createTemporaryResourceRow());

document.querySelector("#open-manager-create").addEventListener("click", () => managerDialog.showModal());
document.querySelector("#close-manager-dialog").addEventListener("click", () => managerDialog.close());
document.querySelector("#cancel-manager-edit").addEventListener("click", () => managerDialog.close());
managerForm.addEventListener("submit", saveManager);

document.querySelector("#close-request-resolve").addEventListener("click", () =>
  document.querySelector("#request-resolve-dialog").close());
document.querySelector("#cancel-request-resolve").addEventListener("click", () =>
  document.querySelector("#request-resolve-dialog").close());
document.querySelector("#request-assigned-add-temporary").addEventListener("click", () =>
  createAssignedTemporaryResourceRow());
document.querySelector("#request-resolve-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const request = requests.find((item) => item.id === resolvingRequestId);
  if (!request) return;
  const decision = form.elements.namedItem("decision").value;
  const assignedResourceIds = [...resolvedAssignedResourceIds];
  const temporaryResources = [...document.querySelectorAll(
    "#request-assigned-temporary-list .temporary-resource-row"
  )].map((row) => ({
    name: row.querySelector("[data-assigned-temporary-name]").value.trim(),
    registration: row.querySelector("[data-assigned-temporary-registration]").value.trim(),
    cis: row.querySelector("[data-assigned-temporary-cis]").value.trim()
  })).filter((item) => item.name && item.cis);
  if (decision === "accepted" && assignedResourceIds.length === 0 && temporaryResources.length === 0) {
    document.querySelector("#request-resolve-error").textContent =
      "Sélectionnez ou indiquez au moins une ressource affectée.";
    return;
  }
  const resolveError = document.querySelector("#request-resolve-error");
  resolveError.textContent = "";
  try {
    if (decision === "accepted") {
      await addDoc(collection(db, "resourceAssignments"), {
        trainingId: request.trainingId,
        sessionId: request.sessionId,
        resourceIds: assignedResourceIds,
        startDate: request.startDate,
        endDate: request.endDate,
        status: "confirmed",
        notes: request.notes,
        temporaryResource: temporaryResources.length > 0,
        temporaryResources,
        createdBy: normalizeEmail(currentUser.email),
        createdAt: serverTimestamp(),
        updatedBy: normalizeEmail(currentUser.email),
        updatedAt: serverTimestamp()
      });
    }
    await updateDoc(doc(db, "resourceRequests", request.id), {
      status: decision,
      assignedResourceIds: decision === "accepted" ? assignedResourceIds : [],
      updatedAt: serverTimestamp()
    });
    await deleteDoc(doc(db, "resourceRequests", request.id));
    document.querySelector("#request-resolve-dialog").close();
    showStatus(decision === "accepted" ? "Demande validée." : "Demande refusée.");
    await loadData();
  } catch (processError) {
    resolveError.textContent = `Impossible de terminer le traitement : ${processError.message}`;
  }
});

assignmentForm.elements.namedItem("startDate").addEventListener("change", (event) => {
  const endDate = assignmentForm.elements.namedItem("endDate");
  endDate.min = event.target.value;
  if (!endDate.value || endDate.value < event.target.value) endDate.value = event.target.value;
});

onAuthStateChanged(auth, initializePage);
