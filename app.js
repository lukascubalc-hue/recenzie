const ACTOR = "compass~crawler-google-places";
const $ = (id) => document.getElementById(id);
const tokenInput = $("token");
const status = $("status");
const findButton = $("findLeads");

tokenInput.value = localStorage.getItem("apifyToken") || "";
$("settingsButton").addEventListener("click", () => $("settings").classList.toggle("hidden"));
$("saveToken").addEventListener("click", () => {
  localStorage.setItem("apifyToken", tokenInput.value.trim());
  $("settings").classList.add("hidden");
  status.textContent = "Token je uložený iba v tomto zariadení.";
});

function setStatus(message) { status.textContent = message; }
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
function render(start, leads, city) {
  $("result").classList.remove("hidden");
  $("resultTitle").textContent = `Trasa: ${city}`;
  $("leadCount").textContent = `${leads.length} leadov`;
  const chunks = []; for (let i = 0; i < leads.length; i += 7) chunks.push(leads.slice(i, i + 7));
  let previous = start;
  $("routeLinks").innerHTML = chunks.map((chunk, index) => {
    const url = mapUrl(previous, chunk); previous = chunk.at(-1).location;
    return `<a href="${url}" target="_blank" rel="noopener">Otvoriť trasu ${index + 1}</a>`;
  }).join("");
  $("leadList").innerHTML = leads.map((lead, index) => `<article class="lead"><div class="order">${index + 1}</div><div><h3>${lead.title}</h3><p class="meta">${lead.searchString} · ★ ${lead.totalScore} · ${lead.reviewsCount} recenzií</p><p class="meta">${lead.address}</p><a href="tel:${lead.phoneUnformatted || lead.phone}">${lead.phone}</a> · <a href="${lead.url}" target="_blank" rel="noopener">Google Maps</a></div></article>`).join("");
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
  const token = (localStorage.getItem("apifyToken") || "").trim();
  const city = $("city").value.trim(); const startAddress = $("startAddress").value.trim();
  const categories = $("categories").value.split(",").map((x) => x.trim()).filter(Boolean);
  const maxReviews = Number($("maxReviews").value); const maxLeads = Number($("maxLeads").value);
  if (!token || !city || !startAddress || !categories.length) { setStatus("Doplň token, mesto, adresu a aspoň jednu kategóriu."); return; }
  findButton.disabled = true;
  try {
    setStatus("Spúšťam Google Maps scraper…");
    const input = { searchStringsArray: categories, locationQuery: `${city}, Slovakia`, maxCrawledPlacesPerSearch: 20, language: "sk" };
    const response = await fetch(`https://api.apify.com/v2/acts/${ACTOR}/runs?token=${encodeURIComponent(token)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
    if (!response.ok) throw new Error("Apify odmietol spustenie. Skontroluj token a kredit.");
    const started = (await response.json()).data;
    const [run, start] = await Promise.all([waitForRun(started.id, token), geocode(startAddress)]);
    setStatus("Vyberám najlepšie leady a plánujem trasu…");
    const dataResponse = await fetch(`https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items?token=${encodeURIComponent(token)}`);
    const rawLeads = await dataResponse.json();
    const eligible = rawLeads.filter((x) => x.phone && x.location && x.reviewsCount >= 5 && x.reviewsCount <= maxReviews && x.totalScore >= 4.5 && !x.permanentlyClosed && !x.temporarilyClosed).sort((a, b) => leadScore(b) - leadScore(a));
    const byCategory = new Map();
    const balanced = eligible.filter((x) => { const used = byCategory.get(x.searchString) || 0; if (used >= 5) return false; byCategory.set(x.searchString, used + 1); return true; }).slice(0, maxLeads);
    if (!balanced.length) throw new Error("Nenašli sa leady, ktoré spĺňajú nastavené filtre.");
    render(start, optimizeRoute(start, balanced), city);
    setStatus(`Hotovo: ${rawLeads.length} výsledkov → ${balanced.length} kvalitných leadov.`);
  } catch (error) { setStatus(error.message || "Niečo sa nepodarilo. Skús to znovu."); }
  finally { findButton.disabled = false; }
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
