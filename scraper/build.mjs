// Turns data/cities.json into the site's data file (site/data.json) and a CSV.
//
//   node scraper/build.mjs

import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { get } from "./lib/http.mjs";

const COLUMNS = [
  "city",
  "country",
  "slug",
  "salary",
  "expenses",
  "rent1brCentre",
  "rent1brOutside",
  "rent3brCentre",
  "rent3brOutside",
  "coli",
  "rentIndex",
  "colRentIndex",
  "groceriesIndex",
  "restaurantIndex",
  "purchasingPowerIndex",
  "dataDate",
  "expensesEstimated",
];

const SCENARIOS = [
  { id: "own1brCentre", rent: "rent1brCentre" },
  { id: "own1brOutside", rent: "rent1brOutside" },
  { id: "room3brCentre", rent: "rent3brCentre", divide: 3 },
  { id: "room3brOutside", rent: "rent3brOutside", divide: 3 },
];

const round = (n, d = 2) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function main() {
  const data = await readJson("data/cities.json", null);
  if (!data) throw new Error("data/cities.json missing");
  const indices = (await readJson("data/indices.json", { cities: [] })).cities || [];
  const bySlug = new Map(indices.map((i) => [i.slug, i]));

  // FX: 1 USD = X <currency>. Primary source covers ~160 currencies, the
  // fallback (ECB only) is used if it is down.
  let fx = { USD: 1 };
  let fxDate = null;
  const sources = [
    {
      url: "https://open.er-api.com/v6/latest/USD",
      pick: (j) => (j.result === "success" ? { rates: j.rates, date: (j.time_last_update_utc || "").slice(5, 16) } : null),
    },
    {
      url: "https://api.frankfurter.dev/v1/latest?base=USD",
      pick: (j) => (j.rates ? { rates: j.rates, date: j.date } : null),
    },
  ];
  for (const src of sources) {
    const res = await get(src.url, { accept: "application/json", retries: 1 });
    if (!res.ok) continue;
    try {
      const picked = src.pick(JSON.parse(res.body));
      if (picked) {
        fx = { ...picked.rates, USD: 1 };
        fxDate = picked.date;
        break;
      }
    } catch {
      console.warn(`could not parse FX from ${src.url}`);
    }
  }
  if (Object.keys(fx).length <= 1) console.warn("no FX rates - site will only offer USD");

  const rows = [];
  // Living costs come from the city pages, which we crawl slowly. For the rest
  // we estimate them the way numbeo builds its index: cost of living index /
  // 100 x the same basket in New York. The anchor is the median of the cities
  // where we do have real numbers, so estimates tighten as pages arrive.
  const ratios = [];
  for (const c of data.cities || []) {
    const i = bySlug.get(c.slug);
    if (c.singleExpenses > 0 && i?.coli > 0) ratios.push(c.singleExpenses / (i.coli / 100));
  }
  ratios.sort((a, b) => a - b);
  const anchor = ratios.length ? ratios[Math.floor(ratios.length / 2)] : 1656;

  for (const c of data.cities || []) {
    if (!c.ok) continue;
    const idx = bySlug.get(c.slug) || {};
    const salary = c.salary ?? null;
    const real = c.singleExpenses ?? null;
    const estimated = real == null && idx.coli > 0;
    const expenses = real ?? (estimated ? Math.round((idx.coli / 100) * anchor) : null);
    const rent = c.rent || {};
    rows.push([
      c.name || c.city,
      c.country,
      c.slug || null,
      round(salary),
      round(expenses),
      round(rent.oneBedCentre),
      round(rent.oneBedOutside),
      round(rent.threeBedCentre),
      round(rent.threeBedOutside),
      round(idx.coli, 1),
      round(idx.rentIndex, 1),
      round(idx.colRentIndex, 1),
      round(idx.groceriesIndex, 1),
      round(idx.restaurantIndex, 1),
      round(idx.purchasingPowerIndex, 1),
      c.dataDate || null,
      estimated ? 1 : 0,
    ]);
  }

  // sort once on the default metric (annual discretionary, room in 3br outside)
  const ai = COLUMNS.indexOf("salary");
  const ei = COLUMNS.indexOf("expenses");
  const oi = COLUMNS.indexOf("rent3brOutside");
  rows.sort((a, b) => {
    const va = a[ai] != null && a[ei] != null && a[oi] != null ? a[ai] * 12 - a[ei] * 12 - (a[oi] / 3) * 12 : -Infinity;
    const vb = b[ai] != null && b[ei] != null && b[oi] != null ? b[ai] * 12 - b[ei] * 12 - (b[oi] / 3) * 12 : -Infinity;
    return vb - va;
  });

  const payload = {
    generatedAt: data.generatedAt,
    builtAt: new Date().toISOString(),
    base: "USD",
    fx,
    fxDate,
    scenarios: SCENARIOS.map((s) => ({ id: s.id, divide: s.divide || 1 })),
    columns: COLUMNS,
    count: rows.length,
    cities: rows,
  };
  await writeFile("site/data.json", JSON.stringify(payload));
  console.log(`site/data.json: ${rows.length} cities, ${Object.keys(fx).length - 1} currencies, fx ${fxDate}`);

  // CSV: one row per city, all four scenarios side by side (USD)
  const head = [
    "city",
    "country",
    "slug",
    "salary_monthly_usd",
    "expenses_monthly_usd",
    "rent_1br_centre_monthly_usd",
    "rent_1br_outside_monthly_usd",
    "rent_3br_centre_monthly_usd",
    "rent_3br_outside_monthly_usd",
    "discretionary_annual_own1br_centre_usd",
    "discretionary_annual_own1br_outside_usd",
    "discretionary_annual_room3br_centre_usd",
    "discretionary_annual_room3br_outside_usd",
    "best_option",
    "discretionary_annual_best_usd",
    "data_date",
  ];
  const esc = (v) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [head.join(",")];
  for (const r of rows) {
    const rec = Object.fromEntries(COLUMNS.map((k, i) => [k, r[i]]));
    const disc = (rentKey, divide = 1) => {
      if (rec.salary == null || rec.expenses == null || rec[rentKey] == null) return null;
      return round((rec.salary - rec.expenses - rec[rentKey] / divide) * 12);
    };
    const options = SCENARIOS.map((sc) => ({ id: sc.id, v: disc(sc.rent, sc.divide || 1) })).filter(
      (o) => o.v != null
    );
    const best = options.sort((a, b) => b.v - a.v)[0] || null;

    lines.push(
      [
        rec.city,
        rec.country,
        rec.slug,
        rec.salary,
        rec.expenses,
        rec.rent1brCentre,
        rec.rent1brOutside,
        rec.rent3brCentre,
        rec.rent3brOutside,
        disc("rent1brCentre"),
        disc("rent1brOutside"),
        disc("rent3brCentre", 3),
        disc("rent3brOutside", 3),
        best ? best.id : "",
        best ? best.v : null,
        rec.dataDate,
      ]
        .map(esc)
        .join(",")
    );
  }
  await writeFile("site/data.csv", lines.join("\n") + "\n");
  console.log(`site/data.csv: ${lines.length - 1} rows`);

  await writeDist();
}

/**
 * The deployable folder. Scripts and styles get their content hash in the file
 * name, so a browser can cache them forever and can never end up running a new
 * page with an old app.js (which is exactly how a tab once rendered empty).
 */
async function writeDist() {
  const hash = async (path) => createHash("sha1").update(await readFile(path)).digest("hex").slice(0, 10);
  const [js, css] = [await hash("site/app.js"), await hash("site/style.css")];

  await mkdir("dist", { recursive: true });
  await copyFile("site/app.js", `dist/app.${js}.js`);
  await copyFile("site/style.css", `dist/style.${css}.css`);
  await copyFile("site/data.json", "dist/data.json");
  await copyFile("site/data.csv", "dist/data.csv");

  const html = (await readFile("site/index.html", "utf8"))
    .replace('href="style.css"', `href="style.${css}.css"`)
    .replace('src="app.js"', `src="app.${js}.js"`);
  await writeFile("dist/index.html", html);
  console.log(`dist/: app.${js}.js, style.${css}.css`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
