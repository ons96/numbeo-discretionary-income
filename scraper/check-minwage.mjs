// Guards the minimum-wage column: no city may show a wage that came from an ILO
// aggregate (regional / sectoral / national-floor average) rather than a
// statutory rate that applies there.
//
//   node scraper/check-minwage.mjs
//
// Exits 1 when the data would publish a fabricated statutory wage. Run after
// merge.mjs (and after build.mjs for the site-level assertions).

import { readFile } from "node:fs/promises";

const readJson = async (path, fallback) => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
};

const AGGREGATE = /regional|sectoral|floor|provincial|sub-?national/i;
const problems = [];
const fail = (msg) => problems.push(msg);

const minwage = await readJson("data/minwage.json", { countries: [] });
const cities = await readJson("data/cities.json", { cities: [] });
const site = await readJson("site/data.json", { cities: [], columns: [] });

const rows = new Map((minwage.countries || []).map((r) => [r.country, r]));

// A row with no basis was crawled before the qualifier was recorded. Fall back
// to the measure text, and refuse to trust a row that carries neither.
const basisOf = (r) => {
  if (!r || r.value == null) return "none";
  if (r.basis) return r.basis;
  if (!r.measure) return "unknown";
  return AGGREGATE.test(r.measure) ? "aggregate" : "national";
};

// 1. Every country row must declare what it measures.
for (const r of minwage.countries || []) {
  if (r.value != null && !r.measure) fail(`${r.country}: value without a measure string`);
}
const counts = { national: 0, aggregate: 0, none: 0, unknown: 0 };
for (const r of minwage.countries || []) counts[basisOf(r)]++;
if (counts.unknown) fail(`${counts.unknown} countries have a value but no measure and no basis`);

// 2. No city may carry a country-scope wage from an aggregate row.
for (const c of cities.cities || []) {
  const mw = c.minWage;
  if (!mw || mw.scope) continue; // scoped rates come from the subnational file
  const row = rows.get(c.country);
  if (basisOf(row) !== "national") {
    fail(`${c.country}/${c.city}: country-scope wage from a ${basisOf(row)} row (${row?.measure || "no measure"})`);
  }
}

// 3. Switzerland is the regression case: no federal minimum wage, so a city
//    with no canton/city rate must have nothing at all.
for (const c of cities.cities || []) {
  if (c.country !== "Switzerland") continue;
  const scoped = c.minWage && c.minWage.scope && c.minWage.scope !== "country";
  if (!scoped && c.minWage) fail(`Switzerland/${c.city}: wage with no Swiss statutory rate behind it`);
}

// 4. Site payload: country-scope rows must trace to a national row. Only
//    meaningful when the payload is at least as new as cities.json - the crawl
//    job rebuilds the data but not the site, so a stale payload here would
//    report yesterday's values, and a country that just turned aggregate would
//    produce a false failure.
const mtime = async (p) => {
  try {
    const { stat } = await import("node:fs/promises");
    return (await stat(p)).mtimeMs;
  } catch {
    return 0;
  }
};
const siteFresh = (await mtime("site/data.json")) >= (await mtime("data/cities.json"));
if (site.columns?.length && siteFresh) {
  const i = Object.fromEntries(site.columns.map((k, n) => [k, n]));
  for (const r of site.cities || []) {
    const scope = r[i.minWageScope];
    const monthly = r[i.minWageMonthlyUsd];
    if (monthly == null) continue;
    if (scope === "country" && basisOf(rows.get(r[i.country])) !== "national") {
      fail(`site: ${r[i.city]}, ${r[i.country]} shows a country-scope wage from an aggregate row`);
    }
  }
} else if (site.columns?.length) {
  console.log("check-minwage: site/data.json is older than data/cities.json, site check skipped");
}

// 5. The subnational file is hand-maintained, so it rots silently. Validate its
//    shape, catch a mapping that points at a region nobody defined, and treat a
//    rate that has not been re-effective for two years as an error.
const subnat = await readJson("data/minwage-subnational.json", { countries: {} });
const thisYear = new Date().getUTCFullYear();
const warnings = [];
for (const [country, block] of Object.entries(subnat.countries || {})) {
  const where = `minwage-subnational[${country}]`;
  for (const key of ["currency", "effective", "source", "sourceUrl"]) {
    if (!block[key]) fail(`${where}: missing ${key}`);
  }
  const period = block.period || "hour";
  if (!["hour", "day", "month"].includes(period)) fail(`${where}: period "${period}" is not hour|day|month`);

  const regions = block.regions || {};
  const cities = { ...(block.cities || {}), ...(block.cityRates || {}) };
  for (const [city, region] of Object.entries(block.cityRegion || {})) {
    if (regions[region] == null) fail(`${where}: city "${city}" maps to region "${region}" that has no rate`);
  }
  for (const [city, value] of Object.entries(cities)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) fail(`${where}: city "${city}" has a non-positive rate`);
  }
  for (const [region, value] of Object.entries(regions)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) fail(`${where}: region "${region}" has a non-positive rate`);
  }

  const year = Number(String(block.effective).slice(0, 4));
  if (Number.isFinite(year)) {
    if (year <= thisYear - 2) fail(`${where}: rates effective ${block.effective} are at least two years stale - re-check ${block.sourceUrl || "the source"}`);
    else if (year < thisYear) warnings.push(`${where}: rates effective ${block.effective}, not ${thisYear}`);
  } else {
    fail(`${where}: effective "${block.effective}" is not a year`);
  }

  // A country with regions but no city mapping silently falls back to nothing.
  const mapped = Object.keys(block.cityRegion || {}).length + Object.keys(block.cityRates || {}).length;
  if (Object.keys(regions).length && mapped === 0 && block.default == null) {
    fail(`${where}: has regional rates but no city maps to them`);
  }
}

// Every dataset city in a covered country should resolve to a rate. A miss means
// a new Numbeo city appeared and the mapping was never extended.
const subCities = new Map();
for (const c of cities.cities || []) {
  if (subnat.countries?.[c.country]) subCities.set(`${c.country}|${c.city}`, !!c.minWage);
}
const unresolved = [...subCities.entries()].filter(([, has]) => !has).map(([k]) => k);
// Not every miss is a bug: some cantons genuinely set no minimum wage. Report the
// count so a mapping that stops matching is visible, without failing the run.
if (unresolved.length) {
  console.log(`check-minwage: ${unresolved.length} cities in covered countries have no statutory rate (expected for e.g. Swiss cantons without one)`);
}

// 6. Report, so a big drop is visible even when nothing fails.
const scopes = {};
for (const c of cities.cities || []) {
  const s = c.minWage ? c.minWage.scope || "country" : "none";
  scopes[s] = (scopes[s] || 0) + 1;
}

console.log(
  `minwage: ${counts.national} national, ${counts.aggregate} aggregate, ${counts.none} none` +
    ` | cities by scope: ${Object.entries(scopes).map(([k, v]) => `${k}=${v}`).join(" ")}`
);

for (const w of warnings) console.warn(`  ~ ${w}`);

if (problems.length) {
  for (const p of problems.slice(0, 25)) console.error(`  ! ${p}`);
  if (problems.length > 25) console.error(`  ! ... ${problems.length - 25} more`);
  console.error(`check-minwage: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log("check-minwage: ok");
