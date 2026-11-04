/* City discretionary-income ranking. No framework, no build step. */

const PAGE = 60;
const state = {
  scenario: "room3brOutside",
  currency: "USD",
  q: "",
  country: "",
  completeOnly: true,
  sort: "disc",
  dir: -1,
  shown: PAGE,
};

let D = null; // data.json
let rows = []; // derived rows
let filtered = [];
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

/* ---------- derive + render ---------- */

function scenarioFields(r) {
  const s = D.scenarios.find((x) => x.id === state.scenario) || D.scenarios[0];
  const rentKey = {
    own1brCentre: "rent1brCentre",
    own1brOutside: "rent1brOutside",
    room3brCentre: "rent3brCentre",
    room3brOutside: "rent3brOutside",
  }[state.scenario];
  const raw = r[rentKey];
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

function apply() {
  const out = [];
  for (const r of rows) {
    if (state.country && r.country !== state.country) continue;
    if (state.q && !r._search.includes(state.q)) continue;
    const f = scenarioFields(r);
    if (state.completeOnly && f.disc == null) continue;
    out.push({ r, f });
  }

  const key = state.sort;
  out.sort((a, b) => {
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
  for (const th of document.querySelectorAll("thead th[data-sort]")) {
    if (th.dataset.sort === state.sort) th.setAttribute("aria-sort", state.dir === -1 ? "descending" : "ascending");
    else th.removeAttribute("aria-sort");
  }

  $("#summary").innerHTML = summary();
  $("#updated").textContent = `updated ${new Date(D.generatedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;

  const shown = filtered.slice(0, state.shown);
  const html = shown
    .map(({ r, f }, i) => {
      const neg = f.disc != null && f.disc < 0;
      return `<tr>
        <td class="num rank">${i + 1}</td>
        <td><span class="city">${esc(r.city)}</span><span class="country">${esc(r.country)}</span></td>
        <td class="num"><span class="disc${neg ? " neg" : ""}">${f.disc == null ? "–" : money(f.disc)}</span></td>
        <td class="num">${f.disc_m == null ? "–" : `<span class="hint">${money(f.disc_m)}</span>`}</td>
        <td class="num hide-sm">${f.salary == null ? "–" : money(f.salary)}</td>
        <td class="num hide-sm">${f.expenses == null ? "–" : money(f.expenses)}</td>
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
