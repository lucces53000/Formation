import {
  connectAuthEmulator
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  connectFirestoreEmulator
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const LOCAL_PROJECT_ID = "demo-formation-local";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
const connectedAuthInstances = new WeakSet();
const connectedFirestoreInstances = new WeakSet();

export const isFirebaseEmulatorEnvironment = LOCAL_HOSTS.has(window.location.hostname);

export function getFirebaseConfig(config) {
  if (!isFirebaseEmulatorEnvironment) return config;

  return {
    ...config,
    apiKey: "demo-api-key",
    authDomain: `${LOCAL_PROJECT_ID}.firebaseapp.com`,
    databaseURL: `https://${LOCAL_PROJECT_ID}-default-rtdb.firebaseio.com`,
    projectId: LOCAL_PROJECT_ID,
    storageBucket: `${LOCAL_PROJECT_ID}.firebasestorage.app`,
    messagingSenderId: "000000000000",
    appId: "1:000000000000:web:000000000000000000000000"
  };
}

export function connectFirebaseEmulators({ auth, db }) {
  if (!isFirebaseEmulatorEnvironment) return;

  if (auth && !connectedAuthInstances.has(auth)) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectedAuthInstances.add(auth);
  }

  if (db && !connectedFirestoreInstances.has(db)) {
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
    connectedFirestoreInstances.add(db);
  }

  if (!document.querySelector(".firebase-emulator-banner")) {
    const banner = document.createElement("div");
    banner.className = "firebase-emulator-banner";
    banner.textContent = "ENVIRONNEMENT DE TEST — données locales, non publiées";
    Object.assign(banner.style, {
      position: "fixed",
      inset: "0 0 auto",
      zIndex: "2147483647",
      padding: "8px 12px",
      background: "#9b1c1c",
      color: "#fff",
      font: "600 14px/1.4 system-ui, sans-serif",
      textAlign: "center"
    });
    document.body.prepend(banner);
    document.body.style.paddingTop = "36px";
  }
}
