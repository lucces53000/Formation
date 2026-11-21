import { firebaseConfig } from "./firebase-config.js";
import { connectFirebaseEmulators, getFirebaseConfig } from "./firebase-environment.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { addDoc, collection, getDocs, getFirestore, serverTimestamp, onSnapshot, query, where } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const app = initializeApp(getFirebaseConfig(firebaseConfig));
const auth = getAuth(app);
const db = getFirestore(app);
connectFirebaseEmulators({ auth, db });

const loginPanel = document.querySelector("#request-login-panel");
const panel = document.querySelector("#request-panel");
const signOutButton = document.querySelector("#request-sign-out");
const status = document.querySelector("#request-status");
const error = document.querySelector("#request-error");
const form = document.querySelector("#request-form");
const grid = document.querySelector("#request-month-grid");
const monthLabel = document.querySelector("#request-month-label");
const calendarSummary = document.querySelector("#request-calendar-summary");
const selectedMonth = new Date();
selectedMonth.setUTCDate(1);
let trainings = [];
let resources = [];
let sessions = [];
let requesterRequests = [];
let requesterListener = null;
const selectedResourceIds = new Set();

function el(tag, className, text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
}
function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
  return new Date(`${value}T00:00:00Z`);
}
function isoDate(date) {
  return date.toISOString().slice(0, 10);
}
function createTemporaryResourceRow(resource = {}) {
  const row = el("div", "temporary-resource-row");
  const nameLabel = el("label", "", "Véhicule");
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.maxLength = 100;
  nameInput.value = resource.name || "";
  nameLabel.append(nameInput);
  const registrationLabel = el("label", "", "Immatriculation (facultative)");
  const registrationInput = document.createElement("input");
  registrationInput.type = "text";
  registrationInput.maxLength = 100;
  registrationInput.value = resource.registration || "";
  registrationLabel.append(registrationInput);
  const cisLabel = el("label", "", "CIS");
  const cisInput = document.createElement("input");
  cisInput.type = "text";
  cisInput.maxLength = 100;
  cisInput.value = resource.cis || "";
  cisInput.required = true;
  cisLabel.append(cisInput);
  const remove = el("button", "button danger", "Retirer");
  remove.type = "button";
  remove.addEventListener("click", () => row.remove());
  row.append(nameLabel, registrationLabel, cisLabel, remove);
  document.querySelector("#request-temporary-list").append(row);
}
function sessionEntries(training) {
  if (training.resourcesEnabled !== true) return [];
  const entries = [];
  (training.sessions || []).forEach((session, index) => entries.push({
    sessionId: `${training.id}|direct||${index}`,
    trainingId: training.id,
    trainingTitle: training.title || training.id,
    sessionName: session.sessionName || "",
    startDate: session.startDate || "",
    endDate: session.endDate || session.startDate || "",
    location: session.location || ""
  }));
  (training.phases || []).forEach((phase, phaseIndex) => (phase.sessions || []).forEach((session, sessionIndex) => entries.push({
    sessionId: `${training.id}|phase|${phaseIndex}|${sessionIndex}`,
    trainingId: training.id,
    trainingTitle: training.title || training.id,
    sessionName: [phase.phaseTitle, session.sessionName].filter(Boolean).join(" · "),
    startDate: session.startDate || "",
    endDate: session.endDate || session.startDate || "",
    location: session.location || ""
  })));
  return entries.filter((item) => item.startDate && !item.cancelled);
}
async function loadData() {
  const [trainingSnapshot, resourceSnapshot] = await Promise.all([
    getDocs(collection(db, "trainings")),
    getDocs(collection(db, "resources"))
  ]);
  trainings = trainingSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  resources = resourceSnapshot.docs.map((item) => ({ id: item.id, ...item.data(), active: item.data().active !== false }));
  sessions = trainings.flatMap(sessionEntries);
  renderOptions();
  renderCalendar();
}
function renderOptions() {
  const sessionSelect = form.elements.namedItem("sessionId");
  sessionSelect.replaceChildren(new Option("Sélectionner une session", ""));
  sessions.sort((a, b) => a.startDate.localeCompare(b.startDate)).forEach((session) => {
    sessionSelect.append(new Option(
      `${session.trainingTitle} — ${session.startDate}${session.endDate !== session.startDate ? ` au ${session.endDate}` : ""}${session.sessionName ? ` — ${session.sessionName}` : ""}${session.location ? ` — ${session.location}` : ""}`,
      session.sessionId
    ));
  });
  const resourceCards = document.querySelector("#request-resource-cards");
  resourceCards.replaceChildren();
  resources.filter((resource) => resource.active).sort((a, b) => a.name.localeCompare(b.name, "fr")).forEach((resource) => {
    const card = el("button", `resource-select-card${selectedResourceIds.has(resource.id) ? " selected" : ""}`);
    card.type = "button";
    card.dataset.resourceId = resource.id;
    card.append(
      el("strong", "", resource.name),
      el("span", "", `${resource.cis}${resource.immatriculation ? ` — ${resource.immatriculation}` : ""}`)
    );
    card.setAttribute("aria-pressed", String(selectedResourceIds.has(resource.id)));
    card.addEventListener("click", () => {
      if (selectedResourceIds.has(resource.id)) selectedResourceIds.delete(resource.id);
      else selectedResourceIds.add(resource.id);
      card.classList.toggle("selected", selectedResourceIds.has(resource.id));
      card.setAttribute("aria-pressed", String(selectedResourceIds.has(resource.id)));
    });
    resourceCards.append(card);
  });
}
function renderCalendar() {
  monthLabel.textContent = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(selectedMonth);
  const year = selectedMonth.getUTCFullYear();
  const month = selectedMonth.getUTCMonth();
  const first = new Date(Date.UTC(year, month, 1));
  const start = new Date(first);
  start.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7));
  grid.replaceChildren();
  ["Lun.", "Mar.", "Mer.", "Jeu.", "Ven.", "Sam.", "Dim."].forEach((name) => grid.append(el("div", "resources-weekday", name)));
  let count = 0;
  for (let i = 0; i < 42; i += 1) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + i);
    const dateKey = isoDate(date);
    const day = el("section", "resources-day");
    if (date.getUTCMonth() !== month) day.classList.add("is-outside");
    day.append(el("span", "resources-day-number", String(date.getUTCDate())));
    sessions.filter((session) => session.startDate <= dateKey && session.endDate >= dateKey).forEach((session) => {
      count += 1;
      const button = el("button", "resources-event", session.trainingTitle);
      button.type = "button";
      button.append(el("span", "resources-event-resource", session.sessionName || session.location || "Session"));
      button.addEventListener("click", () => selectSession(session));
      day.append(button);
    });
    grid.append(day);
  }
  calendarSummary.textContent = `${count} session${count === 1 ? "" : "s"} réservables dans ce mois.`;
}
function selectSession(session) {
  form.elements.namedItem("sessionId").value = session.sessionId;
  form.elements.namedItem("startDate").value = session.startDate;
  form.elements.namedItem("endDate").value = session.endDate;
  document.querySelector("#request-form").scrollIntoView({ behavior: "smooth" });
}
form.elements.namedItem("sessionId").addEventListener("change", (event) => {
  const session = sessions.find((item) => item.sessionId === event.target.value);
  if (session) selectSession(session);
});
document.querySelector("#request-month-previous").addEventListener("click", () => { selectedMonth.setUTCMonth(selectedMonth.getUTCMonth() - 1); renderCalendar(); });
document.querySelector("#request-month-next").addEventListener("click", () => { selectedMonth.setUTCMonth(selectedMonth.getUTCMonth() + 1); renderCalendar(); });
document.querySelector("#request-month-today").addEventListener("click", () => { const now = new Date(); selectedMonth.setUTCFullYear(now.getFullYear(), now.getMonth(), 1); renderCalendar(); });
document.querySelector("#request-add-temporary").addEventListener("click", () => createTemporaryResourceRow());
document.querySelector("#request-login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const loginForm = event.currentTarget;
  try {
    await signInWithEmailAndPassword(auth, loginForm.elements.namedItem("email").value.trim(), loginForm.elements.namedItem("password").value);
  } catch (loginError) {
    status.textContent = `Connexion impossible : ${loginError.message}`;
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const user = auth.currentUser;
  if (!user || !user.emailVerified) {
    error.textContent = "Votre adresse e-mail doit être vérifiée.";
    return;
  }
  const session = sessions.find((item) => item.sessionId === form.elements.namedItem("sessionId").value);
  if (!session) {
    error.textContent = "Sélectionnez une session.";
    return;
  }
  const startDate = form.elements.namedItem("startDate").value;
  const endDate = form.elements.namedItem("endDate").value;
  if (!startDate || !endDate || endDate < startDate ||
    startDate < session.startDate || endDate > (session.endDate || session.startDate)) {
    error.textContent = "Les dates doivent être incluses dans la session.";
    return;
  }
  const resourceIds = [...selectedResourceIds];
  const temporaryResources = [...document.querySelectorAll("#request-temporary-list .temporary-resource-row")].map((row) => ({
    name: row.querySelectorAll("input")[0].value.trim(),
    registration: row.querySelectorAll("input")[1].value.trim(),
    cis: row.querySelectorAll("input")[2].value.trim()
  })).filter((item) => item.name && item.cis);
  if (resourceIds.length === 0 && temporaryResources.length === 0) {
    error.textContent = "Sélectionnez ou indiquez au moins une ressource.";
    return;
  }
  try {
    const reference = await addDoc(collection(db, "resourceRequests"), {
      requesterUid: user.uid,
      requesterEmail: user.email.toLowerCase(),
      trainingId: session.trainingId,
      sessionId: session.sessionId,
      startDate,
      endDate,
      resourceIds,
      temporaryResources,
      notes: form.elements.namedItem("notes").value.trim(),
      status: "pending",
      assignedResourceIds: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    form.reset();
    selectedResourceIds.clear();
    document.querySelector("#request-temporary-list").replaceChildren();
    renderOptions();
    error.textContent = "";
    status.textContent = "Demande envoyée aux gestionnaires.";
    status.className = "status";
    await loadRequesterRequests();
    setRequestTab("current");
  } catch (saveError) {
    error.textContent = `Impossible d’envoyer la demande : ${saveError.message}`;
  }
});

async function loadRequesterRequests() {
  const user = auth.currentUser;
  if (!user) return;
  const snapshot = await getDocs(query(
    collection(db, "resourceRequests"),
    where("requesterUid", "==", user.uid)
  ));
  requesterRequests = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
    .filter((item) => item.status === "pending");
  renderRequesterRequests();
}

function renderRequesterRequests() {
  const list = document.querySelector("#request-current-list");
  const summary = document.querySelector("#request-current-summary");
  list.replaceChildren();
  requesterRequests.sort((left, right) =>
    String(right.createdAt || "").localeCompare(String(left.createdAt || ""), "fr")
  );
  summary.textContent = `${requesterRequests.length} demande${requesterRequests.length === 1 ? "" : "s"} en cours.`;
  if (requesterRequests.length === 0) {
    list.append(el("p", "", "Aucune demande en cours."));
    return;
  }
  requesterRequests.forEach((request) => {
    const training = trainings.find((item) => item.id === request.trainingId);
    const session = sessions.find((item) => item.sessionId === request.sessionId);
    const registeredNames = (request.resourceIds || []).map((resourceId) =>
      resources.find((resource) => resource.id === resourceId)?.name
    ).filter(Boolean);
    const temporaryNames = (request.temporaryResources || []).map((item) =>
      item.registration
        ? `${item.name || "Véhicule ponctuel"} — ${item.registration}`
        : item.name || "Véhicule ponctuel"
    );
    const card = el("article", "resource-card");
    card.append(
      el("h3", "", training?.title || "Formation"),
      el("p", "", `Session : ${session?.sessionName || "Session"}`),
      el("p", "", `Dates : du ${request.startDate} au ${request.endDate}`),
      el("p", "", `Ressources demandées : ${[...registeredNames, ...temporaryNames].join(", ") || "—"}`),
      el("p", "", `Notes : ${request.notes || "—"}`)
    );
    list.append(card);
  });
}

function setRequestTab(tabName) {
  document.querySelectorAll("[data-request-tab]").forEach((tab) => {
    const active = tab.dataset.requestTab === tabName;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll("[data-request-view]").forEach((view) => {
    view.classList.toggle("hidden", view.dataset.requestView !== tabName);
  });
}

document.querySelectorAll("[data-request-tab]").forEach((tab) => {
  tab.addEventListener("click", () => setRequestTab(tab.dataset.requestTab));
});

signOutButton.addEventListener("click", async () => {
  if (requesterListener) requesterListener();
  requesterListener = null;
  await signOut(auth);
});
onAuthStateChanged(auth, async (user) => {
  loginPanel.classList.toggle("hidden", Boolean(user));
  signOutButton.classList.toggle("hidden", !user);
  panel.classList.toggle("hidden", !user);
  if (!user) return;
  if (!user.emailVerified) {
    panel.classList.add("hidden");
    status.textContent = "Votre adresse e-mail doit être vérifiée.";
    status.className = "status error";
    return;
  }
  await loadData();
  await loadRequesterRequests();
  if (requesterListener) requesterListener();
  requesterListener = onSnapshot(
    query(collection(db, "resourceRequests"), where("requesterUid", "==", user.uid)),
    (snapshot) => {
      requesterRequests = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
        .filter((item) => item.status === "pending");
      renderRequesterRequests();
    }
  );
});
