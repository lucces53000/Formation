const MAX_TITLE_LENGTH = 500;
const MAX_MESSAGE_LENGTH = 3000;
const MAX_NOTIFICATION_BYTES = 3500;
const MAX_AGENT_FEEDS_PER_REQUEST = 50;
const MAX_ICS_BYTES = 2_000_000;
const AGENT_OCCUPATIONS = [
  { code: "DS COEPT F1", category: "caisson", colorType: "caisson" },
  { code: "FOR CAISSON", category: "caisson", colorType: "caisson" },
  { code: "F2 FOR", category: "caisson", colorType: "caisson" },
  { code: "F3 FOR", category: "caisson", colorType: "caisson" },
  { code: "F4 FOR", category: "caisson", colorType: "caisson" },
  { code: "F1 RP", category: "caisson", colorType: "caisson" },
  { code: "ASSISTANT INC", category: "incendie", colorType: "assistant" },
  { code: "ASSISTANT COD", category: "incendie", colorType: "assistant" },
  { code: "DS TC INC", category: "incendie", colorType: "incendie" },
  { code: "FOR INC", category: "incendie", colorType: "incendie" }
];

function jsonResponse(body, status, origin, allowedOrigins) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin"
  });
  if (origin && allowedOrigins.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    headers.set("Access-Control-Max-Age", "86400");
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function base64UrlEncode(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function privateKeyBytes(pem) {
  const encoded = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const binary = atob(encoded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function createGoogleAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64UrlEncode(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));
  const unsignedToken = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyBytes(serviceAccount.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsignedToken)
  );
  const assertion = `${unsignedToken}.${base64UrlEncode(signature)}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || typeof result.access_token !== "string") {
    throw new Error("Échec de l’authentification FCM côté serveur.");
  }
  return result.access_token;
}

function isAuthorizedAdministrator(user, env) {
  const allowedEmails = String(env.ADMIN_EMAILS || env.ADMIN_EMAIL || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  return Boolean(
    user?.emailVerified === true &&
    typeof user.email === "string" &&
    allowedEmails.includes(user.email.trim().toLowerCase())
  );
}

async function verifyAdministrator(idToken, env, requiredEmail = "") {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken })
    }
  );
  if (!response.ok) return false;
  const result = await response.json().catch(() => ({}));
  const user = Array.isArray(result.users) ? result.users[0] : null;
  return isAuthorizedAdministrator(user, env)
    && (!requiredEmail || user.email?.trim().toLowerCase() === requiredEmail);
}

function isValidAgentCalendarUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "agatt.sdis53.fr"
      && url.port === ""
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
      && /^\/calendrier\/\d+\/[A-Za-z0-9_-]{16,128}\/occupation\.ics$/.test(url.pathname);
  } catch {
    return false;
  }
}

function parseIcalDate(value) {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?(?:Z)?$/.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText || 0);
  const minute = Number(minuteText || 0);
  const second = Number(secondText || 0);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
    || hour > 23
    || minute > 59
    || second > 59
  ) return null;
  return { date, isDateOnly: !hourText, isMidnight: hour === 0 && minute === 0 && second === 0 };
}

function icalDateKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function getCalendarCoverage(icalText) {
  const unfoldedLines = icalText.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  let eventLines = null;
  let firstDate = "";
  let lastDate = "";
  for (const line of unfoldedLines) {
    if (/^BEGIN:VEVENT$/i.test(line)) {
      eventLines = [];
      continue;
    }
    if (/^END:VEVENT$/i.test(line) && eventLines) {
      const property = (name) => {
        const entry = eventLines.find((item) => new RegExp(`^${name}(?:;[^:]*)?:`, "i").test(item));
        return entry ? entry.slice(entry.indexOf(":") + 1).trim() : "";
      };
      const start = parseIcalDate(property("DTSTART"));
      const parsedEnd = parseIcalDate(property("DTEND"));
      if (start) {
        let end = parsedEnd?.date || start.date;
        if (parsedEnd && end > start.date && (parsedEnd.isDateOnly || parsedEnd.isMidnight)) {
          end = new Date(end.getTime() - 86400000);
        }
        const startDate = icalDateKey(start.date);
        const endDate = icalDateKey(end < start.date ? start.date : end);
        if (!firstDate || startDate < firstDate) firstDate = startDate;
        if (!lastDate || endDate > lastDate) lastDate = endDate;
      }
      eventLines = null;
      continue;
    }
    if (eventLines) eventLines.push(line);
  }
  return firstDate && lastDate
    ? { startDate: firstDate, endDate: lastDate }
    : null;
}

function normalizeOccupationText(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function findAgentOccupation(summary) {
  const normalizedSummary = ` ${normalizeOccupationText(summary)} `;
  return AGENT_OCCUPATIONS.find(({ code }) =>
    normalizedSummary.includes(` ${normalizeOccupationText(code)} `)
  );
}

function getOccupationDurationHours(summary, start, end) {
  const normalizedSummary = normalizeOccupationText(summary);
  const startsAt14 = start.date.getUTCHours() === 14;
  const endsAt12 = end?.date.getUTCHours() === 12;

  if (normalizedSummary.includes("FOR") || normalizedSummary.includes("F1 RP")) {
    return endsAt12 || startsAt14 ? 4.5 : 9;
  }
  if (normalizedSummary.includes("DS")) {
    return endsAt12 || startsAt14 ? 5 : 10;
  }
  return end ? Math.max(0, (end.date.getTime() - start.date.getTime()) / 3600000) : 0;
}

function parseAgentCalendar(icalText, year = null) {
  const unfoldedLines = icalText.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const events = [];
  let eventLines = null;
  for (const line of unfoldedLines) {
    if (/^BEGIN:VEVENT$/i.test(line)) {
      eventLines = [];
      continue;
    }
    if (/^END:VEVENT$/i.test(line) && eventLines) {
      const property = (name) => {
        const entry = eventLines.find((item) => new RegExp(`^${name}(?:;[^:]*)?:`, "i").test(item));
        return entry ? entry.slice(entry.indexOf(":") + 1).trim() : "";
      };
      const summary = property("SUMMARY")
        .replace(/\\n/gi, "\n")
        .replace(/\\,/g, ",")
        .replace(/\\;/g, ";")
        .replace(/\\\\/g, "\\");
      const occupation = findAgentOccupation(summary);
      if (occupation && property("STATUS").trim().toUpperCase() !== "CANCELLED") {
        const start = parseIcalDate(property("DTSTART"));
        const endValue = property("DTEND");
        const parsedEnd = endValue ? parseIcalDate(endValue) : null;
        if (start) {
          const calendarStatus = property("STATUS").trim().toUpperCase() === "CONFIRMED"
            ? "CONFIRMED"
            : "TENTATIVE";
          const durationHours = getOccupationDurationHours(summary, start, parsedEnd);
          let end = parsedEnd?.date || start.date;
          if (parsedEnd && end > start.date && (parsedEnd.isDateOnly || parsedEnd.isMidnight)) {
            end = new Date(end.getTime() - 86400000);
          }
          if (end < start.date) end = start.date;
          events.push({
            sourceId: property("UID")
              ? `${property("UID")}|${property("RECURRENCE-ID")}`
              : `${icalDateKey(start.date)}|${icalDateKey(end)}|${summary}`,
            summary,
            code: occupation.code,
            status: calendarStatus,
            category: occupation.category,
            colorType: occupation.colorType,
            durationHours,
            caissonBurns: occupation.category === "caisson" && calendarStatus === "CONFIRMED"
              ? parsedEnd?.date.getUTCHours() === 12 ? 2 : 3
              : 0,
            exposureMinutes: occupation.category === "caisson" && calendarStatus === "CONFIRMED"
              ? parsedEnd?.date.getUTCHours() === 12 ? 40 : 60
              : 0,
            startDate: icalDateKey(start.date),
            endDate: icalDateKey(end)
          });
        }
      }
      eventLines = null;
      continue;
    }
    if (eventLines) eventLines.push(line);
  }

  if (!Number.isInteger(year)) return events;
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  return events.filter((event) => event.endDate >= yearStart && event.startDate <= yearEnd);
}

async function fetchAgentCalendar(url, year, knownFingerprint = "") {
  let requestUrl = url;
  let response;
  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    try {
      response = await fetch(requestUrl, {
        redirect: "manual",
        headers: {
          Accept: "text/calendar, text/plain;q=0.9, */*;q=0.1",
          Referer: "https://agatt.sdis53.fr/",
          "User-Agent": "Mozilla/5.0 (compatible; SEEC-Calendar/1.0)"
        },
        signal: AbortSignal.timeout(20000)
      });
    } catch (error) {
      if (error.name === "TimeoutError" || error.name === "AbortError") {
        throw new Error("Délai dépassé lors de la récupération du calendrier.");
      }
      throw new Error("Connexion à AGATT impossible depuis le Worker Cloudflare. AGATT doit autoriser les requêtes provenant de Cloudflare.");
    }

    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("Location");
    if (!location || redirectCount === 3) {
      throw new Error("AGATT a redirigé le calendrier trop de fois.");
    }
    let redirectedUrl;
    try {
      redirectedUrl = new URL(location, requestUrl);
    } catch {
      throw new Error("AGATT a renvoyé une redirection invalide.");
    }
    if (!isValidAgentCalendarUrl(redirectedUrl.href)) {
      throw new Error("AGATT a redirigé vers un hôte non autorisé.");
    }
    requestUrl = redirectedUrl.href;
  }
  if (!response.ok) throw new Error(`AGATT a répondu avec le statut HTTP ${response.status}.`);
  const contentLength = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_ICS_BYTES) {
    throw new Error("Le fichier ICS dépasse la taille maximale autorisée.");
  }
  if (!response.body) throw new Error("AGATT a renvoyé un calendrier vide.");
  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_ICS_BYTES) {
      await reader.cancel();
      throw new Error("Le fichier ICS dépasse la taille maximale autorisée.");
    }
    chunks.push(value);
  }
  const data = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const icalText = new TextDecoder().decode(data).replace(/^\uFEFF/, "").trimStart();
  if (!icalText.startsWith("BEGIN:VCALENDAR")) {
    throw new Error("La réponse AGATT n’est pas un fichier iCalendar valide.");
  }
  const fingerprint = base64UrlEncode(await crypto.subtle.digest("SHA-256", data));
  if (knownFingerprint && knownFingerprint === fingerprint) {
    return { events: [], fingerprint, unchanged: true };
  }
  return {
    events: parseAgentCalendar(icalText, year),
    coverage: getCalendarCoverage(icalText),
    fingerprint,
    unchanged: false
  };
}

async function getAgentOccupations(body) {
  const year = body.year;
  const feeds = body.feeds;
  if (year !== undefined && (!Number.isInteger(year) || year < 2000 || year > 2100)) {
    return { error: "Année invalide.", status: 400 };
  }
  if (!Array.isArray(feeds) || feeds.length > MAX_AGENT_FEEDS_PER_REQUEST) {
    return { error: `Le nombre de calendriers par requête doit être compris entre 0 et ${MAX_AGENT_FEEDS_PER_REQUEST}.`, status: 400 };
  }
  if (feeds.some((feed) =>
    !feed
    || typeof feed.agentId !== "string"
    || !/^[A-Za-z0-9_-]{1,150}$/.test(feed.agentId)
    || !isValidAgentCalendarUrl(feed.url)
    || (feed.fingerprint !== undefined && (
      typeof feed.fingerprint !== "string"
      || feed.fingerprint.length > 128
      || !/^[A-Za-z0-9_-]*$/.test(feed.fingerprint)
    ))
  )) {
    return { error: "Un lien de calendrier est invalide.", status: 400 };
  }
  const results = await Promise.all(feeds.map(async ({ agentId, url, fingerprint = "" }) => {
    try {
      return {
        agentId,
        ...await fetchAgentCalendar(url, year, fingerprint)
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Erreur inconnue.";
      console.warn("Agent ICS feed failed", { agentId, reason });
      return {
        agentId,
        events: [],
        error: reason
      };
    }
  }));
  return { results, status: 200 };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const allowedOrigins = new Set(
      String(env.ALLOWED_ORIGINS || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    );

    if (request.method === "OPTIONS") {
      if (!origin || !allowedOrigins.has(origin)) {
        return jsonResponse({ error: "Origine non autorisée." }, 403, origin, allowedOrigins);
      }
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
          "Access-Control-Max-Age": "86400",
          "Vary": "Origin"
        }
      });
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "Méthode non autorisée." }, 405, origin, allowedOrigins);
    }
    if (!origin || !allowedOrigins.has(origin)) {
      return jsonResponse({ error: "Origine non autorisée." }, 403, origin, allowedOrigins);
    }
    if (!request.headers.get("Content-Type")?.toLowerCase().includes("application/json")) {
      return jsonResponse({ error: "Le contenu doit être au format JSON." }, 415, origin, allowedOrigins);
    }

    const authorization = request.headers.get("Authorization") || "";
    const idToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    if (!idToken || idToken.length > 5000) {
      return jsonResponse({ error: "Authentification Firebase requise." }, 401, origin, allowedOrigins);
    }

    try {
      const body = await request.json();
      const requiredEmail = body.kind === "agent_occupations" ? "luc.cesbron@sdis53.fr" : "";
      if (!await verifyAdministrator(idToken, env, requiredEmail)) {
        return jsonResponse({ error: "Compte administrateur vérifié requis." }, 403, origin, allowedOrigins);
      }
      if (body.kind === "agent_occupations") {
        const result = await getAgentOccupations(body);
        const { status, ...responseBody } = result;
        return jsonResponse(responseBody, status, origin, allowedOrigins);
      }

      const title = typeof body.title === "string" ? body.title.trim() : "";
      const message = typeof body.message === "string" ? body.message.trim() : "";
      const standaloneNotification = body.kind === "standalone_notification";
      let notificationData;
      if (standaloneNotification) {
        notificationData = { type: "standalone_notification" };
      } else {
        const announcementId = typeof body.announcementId === "string" ? body.announcementId.trim() : "";
        const announcementType = typeof body.announcementType === "string"
          ? body.announcementType.trim().toUpperCase()
          : "INFO";
        if (!/^\d+$/.test(announcementId)) {
          return jsonResponse({ error: "Identifiant d’annonce invalide." }, 400, origin, allowedOrigins);
        }
        if (!["AJOUT", "ANNULATION", "MODIFICATION", "INFO"].includes(announcementType)) {
          return jsonResponse({ error: "Type d’annonce non pris en charge." }, 400, origin, allowedOrigins);
        }
        notificationData = { type: "announcement", announcementId, announcementType };
      }
      if (!title || !message) {
        return jsonResponse({ error: "Titre et texte obligatoires." }, 400, origin, allowedOrigins);
      }
      if (
        title.length > MAX_TITLE_LENGTH ||
        message.length > MAX_MESSAGE_LENGTH ||
        new TextEncoder().encode(title).length + new TextEncoder().encode(message).length > MAX_NOTIFICATION_BYTES
      ) {
        return jsonResponse({ error: "Le titre ou le message est trop long pour une notification." }, 400, origin, allowedOrigins);
      }

      const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
      if (!serviceAccount.client_email || !serviceAccount.private_key || !env.FIREBASE_PROJECT_ID) {
        throw new Error("Configuration FCM côté Worker incomplète.");
      }

      const accessToken = await createGoogleAccessToken(serviceAccount);
      notificationData.title = title;
      notificationData.body = message;
      const fcmResponse = await fetch(
        `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/messages:send`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            message: {
              topic: "announcements",
              data: notificationData,
              android: { priority: "HIGH" }
            }
          })
        }
      );
      if (!fcmResponse.ok) {
        const fcmError = await fcmResponse.json().catch(() => ({}));
        console.error(
          "FCM send failed:",
          fcmResponse.status,
          fcmError.error?.status || "UNKNOWN",
          fcmError.error?.message || "Aucun détail fourni par FCM."
        );
        return jsonResponse({ error: "Firebase Cloud Messaging a refusé l’envoi." }, 502, origin, allowedOrigins);
      }

      return jsonResponse({ sent: true, status: "accepted_by_fcm" }, 200, origin, allowedOrigins);
    } catch (error) {
      console.error("FCM notification request failed:", error instanceof Error ? error.message : "Erreur inconnue");
      return jsonResponse({ error: "Le service n’a pas pu envoyer la notification." }, 500, origin, allowedOrigins);
    }
  }
};
