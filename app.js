const ACTOR = "compass~crawler-google-places";
const STORAGE_KEY_TOKEN = "apifyToken";
const STORAGE_KEY_LEADS = "saved_nfc_leads";

const $ = (id) => document.getElementById(id);
const tokenInput = $("token");
const status = $("status");
const findButton = $("findLeads");
const clearLeadsButton = $("clearLeads");

let currentRouteData = null;

function setStatus(message) { status.textContent = message; }

async function initToken() {
  const savedToken = localStorage.getItem(STORAGE_KEY_TOKEN);
  if (savedToken) {
    tokenInput.value = savedToken;
    setStatus("Token je pripravený z lokálneho úložiska.");
    return;
  }

  // Try to load token safely from server .env via /api/config
  try {
    const res = await fetch("/api/config");
    if (res.ok) {
      const data = await res.json();
      if (data && data.apifyToken) {
        tokenInput.value = data.apifyToken;
        localStorage.setItem(STORAGE_KEY_TOKEN, data.apifyToken);
        setStatus("Apify token načítaný z .env súboru.");
        return;
      }
    }
  } catch (e) {
    // Offline or static fallback
  }

  setStatus("Pridaj Apify token v nastaveniach alebo do .env súboru.");
}

$("settingsButton").addEventListener("click", () => $("settings").classList.toggle("hidden"));
$("saveToken").addEventListener("click", () => {
  const val = tokenInput.value.trim();
  localStorage.setItem(STORAGE_KEY_TOKEN, val);
  $("settings").classList.add("hidden");
  setStatus(val ? "Token je uložený v tomto zariadení." : "Token bol vymazaný.");
});

function distance(a, b) {
  const latScale = 111.32;
  const lngScale = 111.32 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot((b.lat - a.lat) * latScale, (b.lng - a.lng) * lngScale);
}

function leadScore(lead) {
  const reviews = Number(lead.reviewsCount || 0);
  const rating = Number(lead.totalScore || 0);
  const reviewFit = 30 - Math.abs(Math.min(reviews, 50) - 30);
  return rating * 12 + reviewFit + (lead.website ? 0 : 4);
}

function optimizeRoute(start, leads) {
  const route = [];
  const rest = [...leads];
  let current = start;
  while (rest.length) {
    rest.sort((a, b) => distance(current, a.location) - distance(current, b.location));
    const next = rest.shift(); route.push(next); current = next.location;
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < route.length - 1 && !changed; i++) for (let j = i + 1; j < route.length; j++) {
      const a = i ? route[i - 1].location : start;
      const b = route[i].location, c = route[j].location, d = route[j + 1]?.location;
      const before = distance(a, b) + (d ? distance(c, d) : 0);
      const after = distance(a, c) + (d ? distance(b, d) : 0);
      if (after + 0.00001 < before) { route.splice(i, j - i + 1, ...route.slice(i, j + 1).reverse()); changed = true; break; }
    }
  }
  return route;
}

async function geocode(address) {
  const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(address)}`);
  const places = await response.json();
  if (!places[0]) throw new Error("Štartovaciu adresu sa nepodarilo nájsť.");
  return { lat: Number(places[0].lat), lng: Number(places[0].lon) };
}

function mapUrl(origin, stops) {
  const destination = stops.at(-1).location;
  const waypoints = stops.slice(0, -1).map((x) => `${x.location.lat},${x.location.lng}`).join("|");
  return `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&waypoints=${encodeURIComponent(waypoints)}&travelmode=driving`;
}

function formatSavedTime(isoStr) {
  if (!isoStr) return "";
  try {
    const d = new Date(isoStr);
    return `Uložené: ${d.toLocaleDateString("sk-SK")} ${d.toLocaleTimeString("sk-SK", { hour: "2-digit", minute: "2-digit" })}`;
  } catch (e) {
    return "";
  }
}

function saveLeadsToStorage(start, leads, city, savedAt) {
  const payload = {
    start,
    leads,
    city,
    savedAt: savedAt || new Date().toISOString()
  };
  localStorage.setItem(STORAGE_KEY_LEADS, JSON.stringify(payload));
  currentRouteData = payload;
}

function clearSavedLeads() {
  localStorage.removeItem(STORAGE_KEY_LEADS);
  currentRouteData = null;
  $("result").classList.add("hidden");
  $("leadList").innerHTML = "";
  $("routeLinks").innerHTML = "";
  setStatus("Uložené leady boli vymazané.");
}

if (clearLeadsButton) {
  clearLeadsButton.addEventListener("click", () => {
    if (confirm("Naozaj chceš vymazať uložené leady z tohto zariadenia?")) {
      clearSavedLeads();
    }
  });
}

function toggleLeadDone(index) {
  if (!currentRouteData || !currentRouteData.leads[index]) return;
  currentRouteData.leads[index].done = !currentRouteData.leads[index].done;
  saveLeadsToStorage(currentRouteData.start, currentRouteData.leads, currentRouteData.city, currentRouteData.savedAt);
  render(currentRouteData.start, currentRouteData.leads, currentRouteData.city, currentRouteData.savedAt);
}
window.toggleLeadDone = toggleLeadDone;

function render(start, leads, city, savedAt) {
  currentRouteData = { start, leads, city, savedAt: savedAt || new Date().toISOString() };
  $("result").classList.remove("hidden");
  $("resultTitle").textContent = `Trasa: ${city}`;

  const doneCount = leads.filter((x) => x.done).length;
  $("leadCount").textContent = doneCount > 0 ? `${doneCount}/${leads.length} vybavené` : `${leads.length} leadov`;

  const savedAtElem = $("savedAtInfo");
  if (savedAtElem) {
    savedAtElem.textContent = formatSavedTime(currentRouteData.savedAt);
  }

  const chunks = []; for (let i = 0; i < leads.length; i += 7) chunks.push(leads.slice(i, i + 7));
  let previous = start;
  $("routeLinks").innerHTML = chunks.map((chunk, index) => {
    const url = mapUrl(previous, chunk); previous = chunk.at(-1).location;
    return `<a href="${url}" target="_blank" rel="noopener">Otvoriť trasu ${index + 1}</a>`;
  }).join("");

  $("leadList").innerHTML = leads.map((lead, index) => {
    const isDone = Boolean(lead.done);
    return `
      <article class="lead ${isDone ? "done" : ""}">
        <div class="order">${index + 1}</div>
        <div>
          <div class="lead-header">
            <h3>${lead.title}</h3>
            <button type="button" class="toggle-done-btn" onclick="toggleLeadDone(${index})">
              ${isDone ? "✓ Vybavené" : "Označiť vybavené"}
            </button>
          </div>
          <p class="meta">${lead.searchString || "Prevádzka"} · ★ ${lead.totalScore || "–"} · ${lead.reviewsCount || 0} recenzií</p>
          <p class="meta">${lead.address || ""}</p>
          <div class="lead-actions">
            ${lead.phone ? `<a href="tel:${lead.phoneUnformatted || lead.phone}">📞 ${lead.phone}</a> · ` : ""}
            <a href="${lead.url}" target="_blank" rel="noopener">Google Maps ↗</a>
            ${lead.website ? ` · <a href="${lead.website}" target="_blank" rel="noopener">Web ↗</a>` : ""}
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function restoreSavedLeads() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_LEADS);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (data && Array.isArray(data.leads) && data.leads.length && data.start) {
      render(data.start, data.leads, data.city || "Uložené", data.savedAt);
      setStatus(`Načítané uložené leady (${data.leads.length}) z lokálneho úložiska.`);
      return true;
    }
  } catch (e) {
    console.error("Nepodarilo sa obnoviť uložené leady:", e);
  }
  return false;
}

async function waitForRun(runId, token) {
  for (let attempt = 0; attempt < 90; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const response = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${encodeURIComponent(token)}`);
    const run = (await response.json()).data;
    if (run.status === "SUCCEEDED") return run;
    if (["FAILED", "ABORTED", "TIMED-OUT"].includes(run.status)) throw new Error(`Apify run skončil stavom: ${run.status}`);
    setStatus(`Hľadám prevádzky… (${run.status.toLowerCase()})`);
  }
  throw new Error("Vyhľadávanie trvá príliš dlho. Skús to znovu.");
}

findButton.addEventListener("click", async () => {
  const token = (tokenInput.value || localStorage.getItem(STORAGE_KEY_TOKEN) || "").trim();
  const city = $("city").value.trim();
  const startAddress = $("startAddress").value.trim();
  const categories = $("categories").value.split(",").map((x) => x.trim()).filter(Boolean);
  const maxReviews = Number($("maxReviews").value);
  const maxLeads = Number($("maxLeads").value);

  if (!token || !city || !startAddress || !categories.length) {
    setStatus("Doplň token, mesto, adresu a aspoň jednu kategóriu.");
    return;
  }

  findButton.disabled = true;
  try {
    setStatus("Spúšťam Google Maps scraper…");
    const input = { searchStringsArray: categories, locationQuery: `${city}, Slovakia`, maxCrawledPlacesPerSearch: 20, language: "sk" };
    const response = await fetch(`https://api.apify.com/v2/acts/${ACTOR}/runs?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });
    if (!response.ok) throw new Error("Apify odmietol spustenie. Skontroluj token a kredit.");
    const started = (await response.json()).data;
    const [run, start] = await Promise.all([waitForRun(started.id, token), geocode(startAddress)]);
    setStatus("Vyberám najlepšie leady a plánujem trasu…");
    const dataResponse = await fetch(`https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items?token=${encodeURIComponent(token)}`);
    const rawLeads = await dataResponse.json();
    const eligible = rawLeads.filter((x) => x.phone && x.location && x.reviewsCount >= 5 && x.reviewsCount <= maxReviews && x.totalScore >= 4.5 && !x.permanentlyClosed && !x.temporarilyClosed).sort((a, b) => leadScore(b) - leadScore(a));
    const byCategory = new Map();
    const balanced = eligible.filter((x) => {
      const used = byCategory.get(x.searchString) || 0;
      if (used >= 5) return false;
      byCategory.set(x.searchString, used + 1);
      return true;
    }).slice(0, maxLeads);

    if (!balanced.length) throw new Error("Nenašli sa leady, ktoré spĺňajú nastavené filtre.");
    const optimized = optimizeRoute(start, balanced);
    saveLeadsToStorage(start, optimized, city);
    render(start, optimized, city);
    setStatus(`Hotovo: ${rawLeads.length} výsledkov → ${balanced.length} kvalitných leadov uložených.`);
  } catch (error) {
    setStatus(error.message || "Niečo sa nepodarilo. Skús to znovu.");
  } finally {
    findButton.disabled = false;
  }
});

const importDatasetBtn = $("importDatasetBtn");
const datasetIdInput = $("datasetId");

async function importDataset(datasetId) {
  const token = (tokenInput.value || localStorage.getItem(STORAGE_KEY_TOKEN) || "").trim();
  if (!token) {
    setStatus("Pre import datasetu je nutný Apify token. Vlož ho do nastavení alebo do .env.");
    $("settings").classList.remove("hidden");
    return;
  }
  const cleanId = (datasetId || "").replace(/^#/, "").trim();
  if (!cleanId) {
    setStatus("Zadaj platné Apify Dataset ID.");
    return;
  }

  const city = $("city").value.trim() || "Importované";
  const startAddress = $("startAddress").value.trim();
  const maxReviews = Number($("maxReviews").value) || 500;
  const maxLeads = Number($("maxLeads").value) || 30;

  if (importDatasetBtn) importDatasetBtn.disabled = true;
  setStatus(`Sťahujem dataset #${cleanId} z Apify…`);

  try {
    const res = await fetch(`https://api.apify.com/v2/datasets/${cleanId}/items?token=${encodeURIComponent(token)}`);
    if (!res.ok) {
      if (res.status === 403) throw new Error("Apify 403: Neplatný token alebo nemáš oprávnenie k tomuto datasetu.");
      if (res.status === 404) throw new Error(`Dataset #${cleanId} sa nenašiel.`);
      throw new Error(`Apify chyba (HTTP ${res.status}).`);
    }

    const rawLeads = await res.json();
    if (!Array.isArray(rawLeads) || !rawLeads.length) {
      throw new Error("Dataset je prázdny alebo neobsahuje položky.");
    }

    setStatus(`Spracovávam ${rawLeads.length} leadov z datasetu…`);

    let start = null;
    if (startAddress) {
      try {
        start = await geocode(startAddress);
      } catch (e) {
        console.warn("Štartovaciu adresu sa nepodarilo geokódovať:", e);
      }
    }

    const eligible = rawLeads.filter((x) => x.phone && x.location && (!x.reviewsCount || x.reviewsCount <= maxReviews) && !x.permanentlyClosed && !x.temporarilyClosed).sort((a, b) => leadScore(b) - leadScore(a));
    const leadsToProcess = eligible.length ? eligible : rawLeads.filter((x) => x.location);

    if (!leadsToProcess.length) {
      throw new Error("V datasete sa nenašli žiadne položky s GPS súradnicami.");
    }

    if (!start) {
      start = leadsToProcess[0].location;
    }

    const balanced = leadsToProcess.slice(0, maxLeads);
    const optimized = optimizeRoute(start, balanced);

    saveLeadsToStorage(start, optimized, city);
    render(start, optimized, city);
    $("settings").classList.add("hidden");
    setStatus(`Úspešne importovaných ${optimized.length} leadov z datasetu #${cleanId}!`);
  } catch (err) {
    setStatus(err.message || "Chyba pri importe datasetu.");
  } finally {
    if (importDatasetBtn) importDatasetBtn.disabled = false;
  }
}

if (importDatasetBtn) {
  importDatasetBtn.addEventListener("click", () => {
    const val = datasetIdInput ? datasetIdInput.value : "";
    importDataset(val);
  });
}

const quickImportBtn = $("quickImportBtn");
if (quickImportBtn) {
  quickImportBtn.addEventListener("click", () => {
    importDataset("tAlrTSyTezjfBSiBf");
  });
}

// Initialize on page load
async function bootstrap() {
  await initToken();
  const restored = restoreSavedLeads();
  if (!restored) {
    importDataset("tAlrTSyTezjfBSiBf");
  }
}
bootstrap();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
