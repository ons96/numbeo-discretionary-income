/* City discretionary-income ranking. No framework, no build step. */

const PAGE = 60;

// Short names for the "best option" column, where the tab titles are too long.
const LABELS = {
  own1brCentre: "1-bed, centre",
  own1brOutside: "1-bed, outside",
  room3brCentre: "Room, centre",
  room3brOutside: "Room, outside",
};

// The page opens comparing every city against this one; leave it blank for no
// baseline, or name any city in the dataset.
const DEFAULT_BASELINE = "Oakville, Canada";

const state = {
  scenario: "best",
  currency: "USD",
  q: "",
  country: "",
  completeOnly: true,
  baseline: null,
  sort: "disc",
  dir: -1,
  shown: PAGE,
};

let D = null; // data.json
let rows = []; // derived rows
let filtered = [];
let baseline = { row: null, f: null, threshold: null };
let qualifying = [];
let col = {};

const $ = (s) => document.querySelector(s);
const fmtCache = new Map();

function money(n, opts = {}) {
  const cur = state.currency;
  const key = cur + (opts.compact ? "c" : "");
  if (!fmtCache.has(key)) {
    fmtCache.set(
      key,
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: cur,
        maximumFractionDigits: 0,
        notation: opts.compact ? "compact" : "standard",
      })
    );
  }
  return fmtCache.get(key).format(n * (D.fx[cur] || 1));
}

function pct(n) {
  return n == null ? "–" : Math.round(n * 100) + "%";
}

const norm = (s) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

/* ---------- data ---------- */

async function load() {
  const res = await fetch("data.json", { cache: "no-cache" });
  D = await res.json();
  col = Object.fromEntries(D.columns.map((c, i) => [c, i]));

  rows = D.cities.map((c) => {
    const r = {};
    for (const k of D.columns) r[k] = c[col[k]];
    r._search = norm(`${r.city} ${r.country}`);
    r.slug0 = r.slug;
    return r;
  });

  buildCurrency();
  buildCountries();
  buildBaselineList();
  applyDefaultBaseline();
  wire();
  render();
}

function buildCurrency() {
  const sel = $("#currency");
  const codes = Object.keys(D.fx).filter((c) => D.fx[c] > 0);
  const preferred = ["CAD", "USD", "EUR", "GBP", "AUD", "NZD", "CHF", "JPY", "INR", "BRL", "MXN", "ZAR", "SEK", "NOK", "DKK", "PLN", "TRY", "AED", "SGD", "HKD", "CNY", "KRW", "PHP", "THB", "IDR", "MYR", "VND", "ILS", "CZK", "HUF", "RON", "BGN", "CLP", "COP", "ARS", "EGP", "NGN", "KES", "PKR", "BDT", "UAH", "RUB"];
  const ordered = [...new Set([...preferred.filter((c) => codes.includes(c)), ...codes.sort()])];

  const byRegion = { CA: "CAD", US: "USD", GB: "GBP", AU: "AUD", NZ: "NZD", IE: "EUR", DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", PT: "EUR", AT: "EUR", BE: "EUR", FI: "EUR", GR: "EUR", IN: "INR", JP: "JPY", CN: "CNY", BR: "BRL", MX: "MXN", ZA: "ZAR", CH: "CHF", SE: "SEK", NO: "NOK", DK: "DKK", PL: "PLN", TR: "TRY", AE: "AED", SG: "SGD", HK: "HKD", KR: "KRW", PH: "PHP", TH: "THB", ID: "IDR", MY: "MYR", VN: "VND", IL: "ILS", CZ: "CZK", HU: "HUF", RO: "RON", CL: "CLP", CO: "COP", AR: "ARS", EG: "EGP", NG: "NGN", KE: "KES", PK: "PKR", BD: "BDT", UA: "UAH", RU: "RUB" };
  let region = "";
  try {
    region = new Intl.Locale(navigator.language || "en-US").region || "";
  } catch {}
  const guess = byRegion[region] || "USD";
  state.currency = codes.includes(guess) ? guess : "USD";
  sel.innerHTML = ordered.map((c) => `<option${c === state.currency ? " selected" : ""}>${c}</option>`).join("");
  sel.onchange = () => {
    state.currency = sel.value;
    render();
  };
}

function buildCountries() {
  const counts = new Map();
  for (const r of rows) counts.set(r.country, (counts.get(r.country) || 0) + 1);
  const list = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  $("#country").innerHTML =
    `<option value="">All countries</option>` +
    list.map(([c, n]) => `<option value="${c.replace(/"/g, "&quot;")}">${c} (${n})</option>`).join("");
}

function wire() {
  for (const b of document.querySelectorAll(".scenarios button")) {
    b.onclick = () => {
      state.scenario = b.dataset.scenario;
      state.shown = PAGE;
      render();
    };
  }

  $("#search").oninput = (e) => {
    state.q = norm(e.target.value.trim());
    state.shown = PAGE;
    render();
  };
  $("#country").onchange = (e) => {
    state.country = e.target.value;
    state.shown = PAGE;
    render();
  };
  $("#complete").onchange = (e) => {
    state.completeOnly = e.target.checked;
    state.shown = PAGE;
    render();
  };
  const base = $("#baseline");
  base.oninput = () => setBaseline(base.value);
  base.onchange = () => setBaseline(base.value);
  $("#baseline-clear").onclick = () => {
    base.value = "";
    setBaseline("");
  };

  $("#loadmore").onclick = () => {
    state.shown += PAGE * 2;
    render();
  };

  for (const th of document.querySelectorAll("thead th[data-sort]")) {
    th.onclick = () => {
      const key = th.dataset.sort;
      state.dir = state.sort === key ? -state.dir : -1;
      state.sort = key;
      state.shown = PAGE;
      render();
    };
  }
}

/* ---------- baseline ---------- */

function buildBaselineList() {
  const names = rows.map((r) => r.city).sort((a, b) => a.localeCompare(b));
  $("#baseline-list").innerHTML = names.map((n) => `<option value="${esc(n)}"></option>`).join("");
}

function applyDefaultBaseline() {
  if (!DEFAULT_BASELINE) return;
  const hit = rows.find((r) => r.city.toLowerCase() === DEFAULT_BASELINE.toLowerCase());
  if (!hit) return;
  state.baseline = hit.slug;
  $("#baseline").value = hit.city;
}

/** Set (or clear) the city every other city has to match on left-over money. */
function setBaseline(text) {
  const q = String(text || "").trim().toLowerCase();
  const hit = q ? rows.find((r) => r.city.toLowerCase() === q) : null;
  state.baseline = hit ? hit.slug : null;
  state.shown = PAGE;
  render();
}

/* ---------- derive + render ---------- */

const RENT_KEY = {
  own1brCentre: "rent1brCentre",
  own1brOutside: "rent1brOutside",
  room3brCentre: "rent3brCentre",
  room3brOutside: "rent3brOutside",
};

function fieldsFor(r, id) {
  const s = D.scenarios.find((x) => x.id === id) || D.scenarios[0];
  const raw = r[RENT_KEY[id]];
  const rent = raw == null ? null : raw / (s.divide || 1);
  const salary = r.salary;
  const expenses = r.expenses;
  const disc_m = salary != null && expenses != null && rent != null ? salary - expenses - rent : null;
  return {
    rent,
    salary,
    expenses,
    disc_m,
    disc: disc_m == null ? null : disc_m * 12,
    share: salary ? rent / salary : null,
  };
}

/**
 * The scenario fields for the active tab. "best" picks, per city, whichever of
 * the four leaves the most money - i.e. the cheapest rent that city offers -
 * and remembers which one it was so the table can say so.
 */
function scenarioFields(r) {
  if (state.scenario !== "best") return fieldsFor(r, state.scenario);

  let best = null;
  for (const s of D.scenarios) {
    const f = fieldsFor(r, s.id);
    if (f.disc != null && (!best || f.disc > best.disc)) best = { ...f, bestId: s.id };
  }
  return (
    best || {
      rent: null,
      salary: r.salary,
      expenses: r.expenses,
      disc_m: null,
      disc: null,
      share: null,
      bestId: null,
    }
  );
}

function apply() {
  const baseRow = state.baseline ? rows.find((r) => r.slug === state.baseline) : null;
  const baseF = baseRow ? scenarioFields(baseRow) : null;
  const threshold = baseF && baseF.disc != null ? baseF.disc : null;
  baseline = { row: baseRow, f: baseF, threshold };

  // everyone who leaves at least as much as the baseline city, before the
  // country filter - the country chips stay complete so you can switch between
  // them without losing the list.
  const qualified = [];
  for (const r of rows) {
    if (state.q && !r._search.includes(state.q)) continue;
    const f = scenarioFields(r);
    if (state.completeOnly && f.disc == null) continue;
    if (threshold != null && (f.disc == null || f.disc < threshold - 0.005)) continue;
    qualified.push({ r, f });
  }
  qualifying = qualified;

  const out = state.country ? qualified.filter((x) => x.r.country === state.country) : qualified.slice();

  const key = state.sort;
  out.sort((a, b) => {
    if (key === "best") {
      const av = LABELS[a.f.bestId] || "";
      const bv = LABELS[b.f.bestId] || "";
      return state.dir * av.localeCompare(bv) || b.f.disc - a.f.disc;
    }
    const av = key === "city" ? a.r.city : a.f[key];
    const bv = key === "city" ? b.r.city : b.f[key];
    if (key === "city") return state.dir * String(av).localeCompare(String(bv));
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return state.dir * (av - bv);
  });
  filtered = out;
}

function renderBaseline() {
  const panel = $("#baseline-panel");
  const clear = $("#baseline-clear");
  const { row, threshold } = baseline;

  clear.hidden = !state.baseline;
  if (!state.baseline) {
    panel.hidden = true;
    panel.innerHTML = "";
    return;
  }
  panel.hidden = false;

  if (!row) {
    panel.innerHTML = "<p>That city is no longer in the dataset.</p>";
    return;
  }
  if (threshold == null) {
    panel.innerHTML = `<p><b>${esc(row.city)}</b> has no salary or rent for this rent option, so it cannot be a baseline. Pick another city or another tab.</p>`;
    return;
  }

  const countries = new Map();
  for (const { r } of qualifying) countries.set(r.country, (countries.get(r.country) || 0) + 1);
  const names = [...countries.keys()].sort((a, b) => a.localeCompare(b));

  panel.innerHTML =
    `<p>At least as much left over as <b>${esc(row.city)}</b> — <b>${money(threshold)}</b>/yr · ` +
    `<b>${qualifying.length.toLocaleString()}</b> ${qualifying.length === 1 ? "city" : "cities"} in ` +
    `<b>${names.length}</b> ${names.length === 1 ? "country" : "countries"}</p>` +
    `<div class="chips">` +
    names
      .map(
        (c) =>
          `<button type="button" data-chip="${esc(c)}" aria-pressed="${state.country === c}">${esc(c)} (${countries.get(c)})</button>`
      )
      .join("") +
    `</div>`;

  for (const b of panel.querySelectorAll("[data-chip]")) {
    b.onclick = () => {
      const c = b.dataset.chip;
      state.country = state.country === c ? "" : c;
      $("#country").value = state.country;
      state.shown = PAGE;
      render();
    };
  }
}

// Explain the difference between missing data and cities hidden by a baseline.
function renderBaselineNotice() {
  const panel = $("#baseline-notice");
  panel.hidden = true;
  panel.innerHTML = "";
  if (baseline.threshold == null) return;

  const matching = rows.filter((r) =>
    (!state.country || r.country === state.country) &&
    (!state.q || r._search.includes(state.q))
  );
  const hidden = matching.filter((r) => {
    const f = scenarioFields(r);
    return f.disc != null && f.disc < baseline.threshold - 0.005;
  });
  if (!hidden.length) return;

  panel.hidden = false;
  const location = state.country ? ` in ${esc(state.country)}` : "";
  panel.innerHTML = `<p><b>${hidden.length}</b> cities${location} have data but are hidden because they leave less over than <b>${esc(baseline.row.city)}</b>.</p>` +
    `<button type="button" id="show-below-baseline">Show all cities${location} (clear baseline)</button>`;
  $("#show-below-baseline").onclick = () => {
    $("#baseline").value = "";
    setBaseline("");
  };
}

function summary() {
  const vals = filtered.map((x) => x.f.disc).filter((v) => v != null).sort((a, b) => a - b);
  if (!vals.length) return "";
  const median = vals[Math.floor(vals.length / 2)];
  const top = filtered.find((x) => x.f.disc === vals[vals.length - 1]);
  const p = (v) => money(v, { compact: true });
  return `<span><b>${filtered.length.toLocaleString()}</b> cities</span>
    <span>median <b>${p(median)}</b>/yr</span>
    <span>best <b>${p(vals[vals.length - 1])}</b>/yr${top ? ` (${top.r.city})` : ""}</span>`;
}

function render() {
  apply();

  for (const b of document.querySelectorAll(".scenarios button")) {
    b.setAttribute("aria-selected", String(b.dataset.scenario === state.scenario));
  }
  document.body.classList.toggle("best-mode", state.scenario === "best");
  for (const th of document.querySelectorAll("thead th[data-sort]")) {
    if (th.dataset.sort === state.sort) th.setAttribute("aria-sort", state.dir === -1 ? "descending" : "ascending");
    else th.removeAttribute("aria-sort");
  }

  $("#summary").innerHTML = summary();
  renderBaseline();
  renderBaselineNotice();
  $("#updated").textContent = `updated ${new Date(D.generatedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;

  const shown = filtered.slice(0, state.shown);
  const html = shown
    .map(({ r, f }, i) => {
      const neg = f.disc != null && f.disc < 0;
      return `<tr>
        <td class="num rank">${i + 1}</td>
        <td><span class="city">${esc(r.city)}</span><span class="country">${esc(r.country)}</span></td>
        <td class="only-best">${f.bestId ? LABELS[f.bestId] : "–"}</td>
        <td class="num"><span class="disc${neg ? " neg" : ""}">${f.disc == null ? "–" : money(f.disc)}</span></td>
        <td class="num">${f.disc_m == null ? "–" : `<span class="hint">${money(f.disc_m)}</span>`}</td>
        <td class="num hide-sm">${f.salary == null ? "–" : money(f.salary)}</td>
        <td class="num hide-sm">${f.expenses == null ? "–" : `${r.expensesEstimated ? '<span title="estimated from the cost of living index">≈</span> ' : ""}${money(f.expenses)}`}</td>
        <td class="num">${f.rent == null ? "–" : money(f.rent)}</td>
        <td class="num hide-sm">${pct(f.share)}</td>
      </tr>`;
    })
    .join("");

  $("#rows").innerHTML = html;
  $("#empty").hidden = filtered.length !== 0;
  $("#loadmore").hidden = filtered.length <= state.shown;
  if (state.shown < filtered.length) $("#loadmore").textContent = `Show more (${(filtered.length - state.shown).toLocaleString()} left)`;

  $("#stamp").textContent = `Data scraped ${new Date(D.generatedAt).toISOString().slice(0, 10)} · FX ${D.fxDate || "n/a"} · ${D.count.toLocaleString()} cities in the dataset`;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

load().catch((e) => {
  document.body.insertAdjacentHTML(
    "afterbegin",
    `<p style="padding:16px;color:#b42318">Could not load data.json: ${esc(e.message)}</p>`
  );
});
