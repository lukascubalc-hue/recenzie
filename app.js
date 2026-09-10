const ACTOR = "compass~crawler-google-places";
const STORAGE_KEY_TOKEN = "apifyToken";
const STORAGE_KEY_LEADS = "saved_nfc_leads";
const DEFAULT_DATASET_ID = "tAlrTSyTezjfBSiBf";

const $ = (id) => document.getElementById(id);
const tokenInput = $("token");
const status = $("status");
const findButton = $("findLeads");
const clearLeadsButton = $("clearLeads");
const useGpsBtn = $("useGpsBtn");
const gpsStatus = $("gpsStatus");
const mainDatasetIdInput = $("mainDatasetId");
const mainImportDatasetBtn = $("mainImportDatasetBtn");
const datasetIdInput = $("datasetId");
const importDatasetBtn = $("importDatasetBtn");
const installBanner = $("installBanner");
const installAppBtn = $("installAppBtn");
const dismissInstallBtn = $("dismissInstallBtn");

let currentRouteData = null;
let userGpsCoords = null;
let currentFilter = "all"; // 'all' | 'pending' | 'done'
let deferredInstallPrompt = null;

function setStatus(message) {
  if (status) status.textContent = message;
}

// ----------------------------------------------------
// PWA Inštalácia pre Android / Chrome
// ----------------------------------------------------
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (installBanner) installBanner.classList.remove("hidden");
});

if (installAppBtn) {
  installAppBtn.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    if (choice && choice.outcome === "accepted") {
      if (installBanner) installBanner.classList.add("hidden");
      setStatus("Aplikácia sa inštaluje na tvoju plochu.");
    }
    deferredInstallPrompt = null;
  });
}

if (dismissInstallBtn) {
  dismissInstallBtn.addEventListener("click", () => {
    if (installBanner) installBanner.classList.add("hidden");
  });
}

window.addEventListener("appinstalled", () => {
  if (installBanner) installBanner.classList.add("hidden");
  setStatus("Aplikácia bola úspešne nainštalovaná na plochu.");
});

// ----------------------------------------------------
// Inicializácia API tokenu
// ----------------------------------------------------
async function initToken() {
  const savedToken = localStorage.getItem(STORAGE_KEY_TOKEN);
  if (savedToken) {
    if (tokenInput) tokenInput.value = savedToken;
    setStatus("Token je pripravený z lokálneho úložiska.");
    return;
  }

  // Skúsiť načítať token z lokálneho .env cez ./api/config (ak beží server.ps1)
  try {
    const res = await fetch("./api/config");
    if (res.ok) {
      const data = await res.json();
      if (data && data.apifyToken) {
        if (tokenInput) tokenInput.value = data.apifyToken;
        localStorage.setItem(STORAGE_KEY_TOKEN, data.apifyToken);
        setStatus("Apify token načítaný z .env súboru.");
        return;
      }
    }
  } catch (e) {
    // Statický hosting ako GitHub Pages - ignorujeme
  }

  setStatus("Pripravené. Pre offline leady klikni na Načítať dataset.");
}

if ($("settingsButton")) {
  $("settingsButton").addEventListener("click", () => {
    $("settings").classList.toggle("hidden");
  });
}

if ($("saveToken")) {
  $("saveToken").addEventListener("click", () => {
    const val = tokenInput ? tokenInput.value.trim() : "";
    localStorage.setItem(STORAGE_KEY_TOKEN, val);
    $("settings").classList.add("hidden");
    setStatus(val ? "Token je uložený v tomto zariadení." : "Token bol vymazaný.");
  });
}

// ----------------------------------------------------
// GPS Lokalizácia v teréne (📍 Moja poloha)
// ----------------------------------------------------
if (useGpsBtn) {
  useGpsBtn.addEventListener("click", () => {
    if (!navigator.geolocation) {
      if (gpsStatus) gpsStatus.textContent = "Geolokácia nie je podporovaná v tomto prehliadači.";
      return;
    }

    useGpsBtn.disabled = true;
    useGpsBtn.textContent = "⏳ Zameriavam…";
    if (gpsStatus) gpsStatus.textContent = "Získavam presné GPS súradnice…";

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        userGpsCoords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude
        };
        const accuracy = Math.round(pos.coords.accuracy);
        const addrField = $("startAddress");
        if (addrField) {
          addrField.value = `📍 Moja poloha (${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)})`;
        }
        if (gpsStatus) {
          gpsStatus.textContent = `✓ Poloha zameraná (presnosť ±${accuracy}m)`;
        }
        useGpsBtn.disabled = false;
        useGpsBtn.textContent = "📍 Moja poloha";

        // Ak už máme načítané leady, automaticky prepočítame trasu od novej polohy
        if (currentRouteData && currentRouteData.leads && currentRouteData.leads.length) {
          setStatus("Prepočítavam trasu od tvojej aktuálnej GPS polohy…");
          const reoptimized = optimizeRoute(userGpsCoords, currentRouteData.leads);
          saveLeadsToStorage(userGpsCoords, reoptimized, currentRouteData.city, currentRouteData.savedAt);
          render(userGpsCoords, reoptimized, currentRouteData.city, currentRouteData.savedAt);
          setStatus(`Trasa prepočítaná od tvojej GPS polohy (±${accuracy}m).`);
        }
      },
      (err) => {
        useGpsBtn.disabled = false;
        useGpsBtn.textContent = "📍 Moja poloha";
        let errMsg = "Nepodarilo sa získať polohu.";
        if (err.code === 1) errMsg = "Prístup k polohe bol zamietnutý v nastaveniach.";
        else if (err.code === 2) errMsg = "GPS signál nie je dostupný.";
        else if (err.code === 3) errMsg = "Získanie polohy vypršalo (timeout).";
        if (gpsStatus) gpsStatus.textContent = errMsg;
        setStatus(errMsg);
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0
      }
    );
  });
}

// ----------------------------------------------------
// Optimalizácia trasy & Geokódovanie
// ----------------------------------------------------
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
    const next = rest.shift();
    route.push(next);
    current = next.location;
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < route.length - 1 && !changed; i++) {
      for (let j = i + 1; j < route.length; j++) {
        const a = i ? route[i - 1].location : start;
        const b = route[i].location,
          c = route[j].location,
          d = route[j + 1]?.location;
        const before = distance(a, b) + (d ? distance(c, d) : 0);
        const after = distance(a, c) + (d ? distance(b, d) : 0);
        if (after + 0.00001 < before) {
          route.splice(i, j - i + 1, ...route.slice(i, j + 1).reverse());
          changed = true;
          break;
        }
      }
    }
  }
  return route;
}

async function geocode(address) {
  if (userGpsCoords && (address.includes("Moja poloha") || address.includes("GPS"))) {
    return userGpsCoords;
  }
  if (address === "Hlavná 12, Trnava" || address.trim() === "Trnava") {
    return { lat: 48.3775, lng: 17.5883 };
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(address)}`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    if (response.ok) {
      const places = await response.json();
      if (places && places[0]) {
        return { lat: Number(places[0].lat), lng: Number(places[0].lon) };
      }
    }
  } catch (e) {
    console.warn("Geocoding failed or timed out, using fallback:", e);
  }
  if (address.toLowerCase().includes("trnava")) {
    return { lat: 48.3775, lng: 17.5883 };
  }
  return null;
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

// ----------------------------------------------------
// Úložisko leadov (LocalStorage)
// ----------------------------------------------------
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
  $("routeLinks").innerHTML = "";
  $("leadCount").textContent = "0 leadov";
  if ($("clearLeads")) $("clearLeads").classList.add("hidden");
  if ($("savedAtInfo")) $("savedAtInfo").textContent = "";
  updateFilterCounters([]);
  renderSummaryStats([]);
  $("leadList").innerHTML = `
    <div id="emptyState" class="empty-state">
      <p>📭 Zatiaľ nie sú načítané žiadne leady.</p>
      <p class="hint">Klikni na <strong>📥 Načítať dataset</strong> vyššie pre okamžité zobrazenie podnikov.</p>
    </div>
  `;
  setStatus("Uložené leady boli vymazané.");
}

if (clearLeadsButton) {
  clearLeadsButton.addEventListener("click", () => {
    if (confirm("Naozaj chceš vymazať uložené leady z tohto zariadenia?")) {
      clearSavedLeads();
    }
  });
}

// ----------------------------------------------------
// Mini-CRM Dátový model & Funkcie
// ----------------------------------------------------
function normalizeLead(lead) {
  if (!lead.crmStatus) {
    lead.crmStatus = lead.done ? "sold" : "new";
  }
  lead.soldCount = Number(lead.soldCount || (lead.crmStatus === "sold" ? 1 : 0));
  lead.revenue = Number(lead.revenue || (lead.crmStatus === "sold" ? 30 : 0));
  lead.note = lead.note || "";
  return lead;
}

function renderSummaryStats(leads) {
  leads.forEach(normalizeLead);
  const contacted = leads.filter((l) => l.crmStatus && l.crmStatus !== "new").length;
  const soldPieces = leads.reduce((acc, l) => acc + (l.crmStatus === "sold" ? Number(l.soldCount) || 1 : 0), 0);
  const revenue = leads.reduce((acc, l) => acc + (l.crmStatus === "sold" ? Number(l.revenue) || 0 : 0), 0);

  if ($("statContacted")) $("statContacted").textContent = `${contacted} / ${leads.length}`;
  if ($("statSoldPieces")) $("statSoldPieces").textContent = `${soldPieces} ks`;
  if ($("statRevenue")) $("statRevenue").textContent = `${revenue} €`;
}

function updateFilterCounters(leads) {
  leads.forEach(normalizeLead);
  const all = leads.length;
  const newCount = leads.filter((l) => (l.crmStatus || "new") === "new").length;
  const soldCount = leads.filter((l) => l.crmStatus === "sold").length;
  const followupCount = leads.filter((l) => l.crmStatus === "followup").length;
  const rejectedCount = leads.filter((l) => l.crmStatus === "rejected").length;

  if ($("allCount")) $("allCount").textContent = all;
  if ($("newCount")) $("newCount").textContent = newCount;
  if ($("soldCountBadge")) $("soldCountBadge").textContent = soldCount;
  if ($("followupCount")) $("followupCount").textContent = followupCount;
  if ($("rejectedCount")) $("rejectedCount").textContent = rejectedCount;
}

function setLeadStatus(index, newStatus) {
  if (!currentRouteData || !currentRouteData.leads[index]) return;
  const lead = currentRouteData.leads[index];
  if (lead.crmStatus === newStatus) {
    lead.crmStatus = "new";
    lead.done = false;
  } else {
    lead.crmStatus = newStatus;
    lead.done = newStatus === "sold";
    if (newStatus === "sold" && (!lead.soldCount || lead.soldCount <= 0)) {
      lead.soldCount = 1;
      lead.revenue = 30;
    }
  }
  saveLeadsToStorage(currentRouteData.start, currentRouteData.leads, currentRouteData.city, currentRouteData.savedAt);
  renderSummaryStats(currentRouteData.leads);
  renderLeadList(currentRouteData.leads);
}
window.setLeadStatus = setLeadStatus;

function updateSoldDetails(index, count, rev) {
  if (!currentRouteData || !currentRouteData.leads[index]) return;
  const lead = currentRouteData.leads[index];
  lead.soldCount = Math.max(1, Number(count) || 1);
  lead.revenue = Math.max(0, Number(rev) || 0);
  saveLeadsToStorage(currentRouteData.start, currentRouteData.leads, currentRouteData.city, currentRouteData.savedAt);
  renderSummaryStats(currentRouteData.leads);
  const badge = document.getElementById(`status-badge-${index}`);
  if (badge) {
    badge.textContent = `🟢 Predané: ${lead.soldCount} ks · ${lead.revenue} €`;
  }
}
window.updateSoldDetails = updateSoldDetails;

function saveLeadNote(index, noteText) {
  if (!currentRouteData || !currentRouteData.leads[index]) return;
  currentRouteData.leads[index].note = noteText.trim();
  saveLeadsToStorage(currentRouteData.start, currentRouteData.leads, currentRouteData.city, currentRouteData.savedAt);
}
window.saveLeadNote = saveLeadNote;

// ----------------------------------------------------
// Predajný asistent & Kalkulačka recenzií
// ----------------------------------------------------
function calculateReviewGap(currentScore, reviewsCount, targetScore = 4.8) {
  const score = Number(currentScore) || 0;
  const count = Number(reviewsCount) || 0;
  if (score <= 0 || count <= 0) {
    return { type: "need_more", needed: 15, targetScore: 4.8 };
  }
  if (score < targetScore) {
    const needed = Math.max(1, Math.ceil(((targetScore - score) * count) / (5 - targetScore)));
    return { type: "need_more", needed, targetScore };
  } else {
    const dropReviews = Math.max(1, Math.ceil(((score - 4.5) * count) / 3.5));
    return { type: "protect", dropReviews, targetScore: 4.5 };
  }
}

function generateSalesPitch(lead, gap) {
  const cat = lead.categoryName || lead.searchString || "prevádzku";
  const title = lead.title || "váš podnik";
  const score = Number(lead.totalScore) || 4.2;
  const count = Number(lead.reviewsCount) || 15;

  if (gap.type === "need_more") {
    return `„Dobrý deň! Vidím, že máte skvelý ${cat} a spokojných hostí (${score}★), ale na Google Mapách máte zatiaľ iba ${count} recenzií. Aby ste dosiahli ideálne skóre ${gap.targetScore}★ a predbehli konkurenciu v okolí, potrebujete získať ešte približne ${gap.needed} nových 5-hviezdičkových recenzií. Náš NFC stojanček na pult to vyrieši – hosť len priloží mobil a za 3 sekundy vám nechá 5 hviezdičiek skôr, ako odíde.“`;
  } else {
    return `„Dobrý deň! Gratulujem k perfektnému hodnoteniu ${score}★ v ${title}. Pri ${count} recenziách však stačí len ${gap.dropReviews} negatívne hodnotenie od nahnevaného človeka a vaše skóre spadne pod ${gap.targetScore}★. Náš NFC stojanček vám slúži ako ochranný štít – systematicky zbiera recenzie od stoviek spokojných zákazníkov, takže vám žiadna zlá recenzia nepokazí reputáciu.“`;
  }
}

function togglePitchDrawer(index) {
  const el = document.getElementById(`pitch-drawer-${index}`);
  if (el) el.classList.toggle("hidden");
}
window.togglePitchDrawer = togglePitchDrawer;

function copyPitchText(index, btn) {
  const pitchTextEl = document.getElementById(`pitch-text-${index}`);
  if (!pitchTextEl) return;
  navigator.clipboard.writeText(pitchTextEl.textContent).then(() => {
    const orig = btn.textContent;
    btn.textContent = "✓ Skopírované do schránky!";
    setTimeout(() => {
      btn.textContent = orig;
    }, 2500);
  });
}
window.copyPitchText = copyPitchText;

// ----------------------------------------------------
// Filtrovanie a vykreslenie zoznamu
// ----------------------------------------------------
function setupFilterTabs() {
  const tabs = [
    { id: "filterAll", mode: "all" },
    { id: "filterNew", mode: "new" },
    { id: "filterSold", mode: "sold" },
    { id: "filterFollowup", mode: "followup" },
    { id: "filterRejected", mode: "rejected" }
  ];

  tabs.forEach((tab) => {
    const el = $(tab.id);
    if (!el) return;
    el.addEventListener("click", () => {
      currentFilter = tab.mode;
      tabs.forEach((t) => $(t.id)?.classList.remove("active"));
      el.classList.add("active");
      if (currentRouteData) {
        renderLeadList(currentRouteData.leads);
      }
    });
  });
}
setupFilterTabs();

function renderLeadList(leads) {
  const container = $("leadList");
  if (!container) return;

  leads.forEach(normalizeLead);
  updateFilterCounters(leads);
  renderSummaryStats(leads);

  let filteredIndices = leads
    .map((lead, idx) => ({ lead, idx }))
    .filter(({ lead }) => {
      const st = lead.crmStatus || "new";
      if (currentFilter === "new") return st === "new";
      if (currentFilter === "sold") return st === "sold";
      if (currentFilter === "followup") return st === "followup";
      if (currentFilter === "rejected") return st === "rejected";
      return true;
    });

  if (!filteredIndices.length) {
    let emptyMsg = "V tejto kategórii sa nenachádzajú žiadne leady.";
    if (currentFilter === "sold") emptyMsg = "Zatiaľ nebol zaznamenaný žiaden predaj.";
    else if (currentFilter === "followup") emptyMsg = "Žiadne odložené kontakty.";
    else if (currentFilter === "rejected") emptyMsg = "Žiadne odmietnuté leady.";
    container.innerHTML = `<div class="empty-state"><p>${emptyMsg}</p></div>`;
    return;
  }

  container.innerHTML = filteredIndices
    .map(({ lead, idx }) => {
      const st = lead.crmStatus || "new";
      const isSold = st === "sold";
      const phoneDigits = (lead.phone || "").replace(/[^0-9+]/g, "");
      const navUrl = lead.location
        ? `https://www.google.com/maps/dir/?api=1&destination=${lead.location.lat},${lead.location.lng}`
        : lead.url || "#";

      let statusBadgeText = "⚪ Neoslovené";
      if (st === "sold") statusBadgeText = `🟢 Predané: ${lead.soldCount || 1} ks · ${lead.revenue || 30} €`;
      else if (st === "followup") statusBadgeText = "🟡 Záujem / Zavolať neskôr";
      else if (st === "rejected") statusBadgeText = "🔴 Odmietnuté";
      else if (st === "closed") statusBadgeText = "⚪ Zatvorené / Neexistuje";

      const gap = calculateReviewGap(lead.totalScore, lead.reviewsCount);
      const pitch = generateSalesPitch(lead, gap);

      return `
        <article class="lead ${isSold ? "done" : ""}" id="lead-${idx}">
          <div class="order">${idx + 1}</div>
          <div>
            <div class="lead-header">
              <div>
                <span id="status-badge-${idx}" class="status-badge ${st}">${statusBadgeText}</span>
                <h3>${lead.title || "Bez názvu"}</h3>
              </div>
            </div>
            <p class="meta">
              <span class="meta-rating">★ ${lead.totalScore || "–"}</span> · ${lead.reviewsCount || 0} recenzií · ${lead.categoryName || lead.searchString || "Podnik"}
            </p>
            <p class="meta">${lead.address || ""}</p>

            <div class="lead-actions-row">
              ${
                phoneDigits
                  ? `<a href="tel:${phoneDigits}" class="action-btn btn-call" title="Zavolať podniku">📞 Volať</a>`
                  : ""
              }
              <a href="${navUrl}" target="_blank" rel="noopener" class="action-btn btn-nav" title="Spustiť navigáciu v Google Mapách">🗺 Navigovať</a>
              ${
                lead.website
                  ? `<a href="${lead.website}" target="_blank" rel="noopener" class="action-btn btn-web" title="Navštíviť web">🌐 Web</a>`
                  : ""
              }
            </div>

            <!-- Mini-CRM Stavy -->
            <div class="crm-status-picker">
              <button type="button" class="crm-status-btn btn-sold ${st === "sold" ? "active" : ""}" onclick="setLeadStatus(${idx}, 'sold')">🟢 Predané</button>
              <button type="button" class="crm-status-btn btn-followup ${st === "followup" ? "active" : ""}" onclick="setLeadStatus(${idx}, 'followup')">🟡 Neskôr</button>
              <button type="button" class="crm-status-btn btn-rejected ${st === "rejected" ? "active" : ""}" onclick="setLeadStatus(${idx}, 'rejected')">🔴 Nie</button>
              <button type="button" class="crm-status-btn btn-closed ${st === "closed" ? "active" : ""}" onclick="setLeadStatus(${idx}, 'closed')">⚪ Zavreté</button>
            </div>

            ${
              isSold
                ? `
              <div class="sold-details-row">
                <label>Kusov: <input type="number" min="1" max="99" value="${lead.soldCount || 1}" oninput="updateSoldDetails(${idx}, this.value, document.getElementById('rev-${idx}').value)" /></label>
                <label>Tržba €: <input id="rev-${idx}" type="number" min="0" step="5" value="${lead.revenue || 30}" oninput="updateSoldDetails(${idx}, ${lead.soldCount || 1}, this.value)" /></label>
              </div>
            `
                : ""
            }

            <!-- Poznámka -->
            <div class="crm-note-row">
              <input type="text" class="lead-note-input" value="${(lead.note || "").replace(/"/g, "&quot;")}" placeholder="✍️ Pridať poznámku (napr. majiteľ príde o 14:00)..." onchange="saveLeadNote(${idx}, this.value)" />
            </div>

            <!-- Predajný asistent & Kalkulačka -->
            <button type="button" class="action-btn btn-pitch" onclick="togglePitchDrawer(${idx})">
              💡 Predajný pitch & kalkulačka ▾
            </button>

            <div id="pitch-drawer-${idx}" class="pitch-drawer hidden">
              <div class="pitch-metrics">
                <div>
                  <span class="pitch-metric-title">Hodnotenie</span>
                  <span class="pitch-metric-val">★ ${lead.totalScore || "–"}</span>
                </div>
                <div>
                  <span class="pitch-metric-title">Recenzií</span>
                  <span class="pitch-metric-val">${lead.reviewsCount || 0}</span>
                </div>
                <div>
                  <span class="pitch-metric-title">${gap.type === "need_more" ? "Cieľ 4.8★" : "Ochranný limit"}</span>
                  <span class="pitch-metric-val">${gap.type === "need_more" ? `+${gap.needed} päť★` : `Štít`}</span>
                </div>
              </div>
              <div class="pitch-speech-bubble">
                <strong>🎤 Čo povedať majiteľovi na prevádzke:</strong>
                <p id="pitch-text-${idx}" style="margin:0 0 8px;">${pitch}</p>
                <button type="button" class="copy-pitch-btn" onclick="copyPitchText(${idx}, this)">📋 Skopírovať rozhovor</button>
              </div>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

// ----------------------------------------------------
// Vykreslenie celej trasy a zoznamu
// ----------------------------------------------------
function render(start, leads, city, savedAt) {
  leads.forEach(normalizeLead);
  currentRouteData = { start, leads, city, savedAt: savedAt || new Date().toISOString() };
  $("resultTitle").textContent = `Trasa: ${city}`;

  const soldCount = leads.filter((x) => x.crmStatus === "sold").length;
  $("leadCount").textContent = soldCount > 0 ? `${soldCount}/${leads.length} predané` : `${leads.length} leadov`;

  if ($("clearLeads")) $("clearLeads").classList.remove("hidden");

  const savedAtElem = $("savedAtInfo");
  if (savedAtElem) {
    savedAtElem.textContent = formatSavedTime(currentRouteData.savedAt);
  }

  // Generovanie odkazov na Google Maps (rozdelené po 7 zastávkach)
  const chunks = [];
  for (let i = 0; i < leads.length; i += 7) chunks.push(leads.slice(i, i + 7));
  let previous = start;
  $("routeLinks").innerHTML = chunks
    .map((chunk, index) => {
      const url = mapUrl(previous, chunk);
      previous = chunk.at(-1).location;
      return `<a href="${url}" target="_blank" rel="noopener">🗺 Celá trasa (časť ${index + 1})</a>`;
    })
    .join("");

  renderSummaryStats(leads);
  renderLeadList(leads);
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

// ----------------------------------------------------
// Import existujúceho Apify datasetu (alebo lokálneho JSON súboru)
// ----------------------------------------------------
async function importDataset(datasetId) {
  const cleanId = (datasetId || DEFAULT_DATASET_ID).trim();
  if (!cleanId) {
    setStatus("Zadaj platné Dataset ID.");
    return;
  }

  const btn = mainImportDatasetBtn || importDatasetBtn;
  if (btn) btn.disabled = true;
  setStatus(`Načítavam dataset #${cleanId}…`);

  try {
    const city = $("city").value.trim() || "Trnava";
    const startAddress = $("startAddress").value.trim();
    const maxReviews = Number($("maxReviews").value) || 50;
    const maxLeads = Number($("maxLeads").value) || 20;

    let rawLeads = null;

    // 1. Skúsiť načítať priamo z lokálne pribaleného JSON datasetu (funguje instantne offline aj online)
    if (cleanId === DEFAULT_DATASET_ID) {
      try {
        const localRes = await fetch("./dataset_leads.json");
        if (localRes.ok) {
          rawLeads = await localRes.json();
        }
      } catch (e) {
        console.warn("Lokálny dataset_leads.json sa nepodarilo načítať:", e);
      }
    }

    // 2. Ak lokálny súbor neexistuje alebo ide o iné ID, stiahnuť z Apify verejnej API
    if (!rawLeads) {
      const token = (tokenInput ? tokenInput.value : "") || localStorage.getItem(STORAGE_KEY_TOKEN) || "";
      const tokenQuery = token ? `?token=${encodeURIComponent(token.trim())}` : "";
      const url = `https://api.apify.com/v2/datasets/${encodeURIComponent(cleanId)}/items${tokenQuery}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Dataset #${cleanId} sa nepodarilo stiahnuť (HTTP ${res.status}).`);
      }
      rawLeads = await res.json();
    }

    if (!Array.isArray(rawLeads) || !rawLeads.length) {
      throw new Error("Dataset je prázdny alebo neobsahuje položky.");
    }

    setStatus(`Spracovávam ${rawLeads.length} leadov z datasetu…`);

    let start = userGpsCoords;
    if (!start && startAddress) {
      try {
        start = await geocode(startAddress);
      } catch (e) {
        console.warn("Štartovaciu adresu sa nepodarilo geokódovať:", e);
      }
    }

    const eligible = rawLeads
      .filter((x) => x.phone && x.location && (!x.reviewsCount || x.reviewsCount <= maxReviews) && !x.permanentlyClosed && !x.temporarilyClosed)
      .sort((a, b) => leadScore(b) - leadScore(a));
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
    if (btn) btn.disabled = false;
  }
}

if (mainImportDatasetBtn) {
  mainImportDatasetBtn.addEventListener("click", () => {
    const val = mainDatasetIdInput ? mainDatasetIdInput.value : DEFAULT_DATASET_ID;
    importDataset(val);
  });
}

if (importDatasetBtn) {
  importDatasetBtn.addEventListener("click", () => {
    const val = datasetIdInput ? datasetIdInput.value : DEFAULT_DATASET_ID;
    importDataset(val);
  });
}

// ----------------------------------------------------
// Spustenie nového Apify crawlera
// ----------------------------------------------------
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

if (findButton) {
  findButton.addEventListener("click", async () => {
    const token = (tokenInput.value || localStorage.getItem(STORAGE_KEY_TOKEN) || "").trim();
    const city = $("city").value.trim();
    const startAddress = $("startAddress").value.trim();
    const categories = $("categories").value.split(",").map((x) => x.trim()).filter(Boolean);
    const maxReviews = Number($("maxReviews").value);
    const maxLeads = Number($("maxLeads").value);

    if (!token) {
      $("settings").classList.remove("hidden");
      if (tokenInput) {
        tokenInput.focus();
        tokenInput.scrollIntoView({ behavior: "smooth" });
      }
      return setStatus("⚠️ Pre vyhľadanie nového mesta vlož Apify API token v nastaveniach vyššie.");
    }
    if (!city) return setStatus("Zadaj názov mesta.");
    if (!startAddress) return setStatus("Zadaj štartovaciu adresu alebo použi '📍 Moja poloha'.");

    findButton.disabled = true;
    try {
      setStatus("Získavam polohu štartu…");
      const start = await geocode(startAddress);
      setStatus("Spúšťam Apify crawler…");

      const queries = categories.map((c) => `${c} ${city}`);
      const runRes = await fetch(`https://api.apify.com/v2/acts/${ACTOR}/runs?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          searchStringsArray: queries,
          locationQuery: `${city}, Slovakia`,
          maxCrawledPlacesPerSearch: 25,
          language: "sk",
          skipClosedPlaces: true
        })
      });

      if (!runRes.ok) throw new Error("Nepodarilo sa spustiť Apify crawler.");
      const runData = (await runRes.json()).data;
      setStatus("Crawler beží na pozadí…");

      const finishedRun = await waitForRun(runData.id, token);
      const datasetRes = await fetch(`https://api.apify.com/v2/datasets/${finishedRun.defaultDatasetId}/items?token=${encodeURIComponent(token)}`);
      const items = await datasetRes.json();

      const eligible = items
        .filter((x) => x.phone && x.location && (!x.reviewsCount || x.reviewsCount <= maxReviews) && !x.permanentlyClosed && !x.temporarilyClosed)
        .sort((a, b) => leadScore(b) - leadScore(a));

      if (!eligible.length) throw new Error("Nenašli sa vyhovujúce leady.");

      const balanced = eligible.slice(0, maxLeads);
      const optimized = optimizeRoute(start, balanced);

      saveLeadsToStorage(start, optimized, city);
      render(start, optimized, city);
      setStatus(`Hotovo! Nájdených ${optimized.length} leadov.`);
    } catch (err) {
      setStatus(err.message || "Nastala chyba pri hľadaní leadov.");
    } finally {
      findButton.disabled = false;
    }
  });
}

// ----------------------------------------------------
// Inicializácia pri štarte aplikácie
// ----------------------------------------------------
async function bootstrap() {
  await initToken();
  const restored = restoreSavedLeads();
  if (!restored) {
    importDataset(DEFAULT_DATASET_ID);
  }
}
bootstrap();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js?v=4");
}
