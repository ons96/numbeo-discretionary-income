// Fetches Numbeo's quality-of-life and crime ranking tables and writes
// data/quality.json + data/crime.json. Joined to cities by "City, Country".
//
//   node scraper/crawl-safety.mjs [--max-age-hours=20] [--force]

import { writeIfChanged, parseArgs, freshEnough, failedFetch } from "./lib/store.mjs";
import { get } from "./lib/http.mjs";

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const stripTags = (s) => s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const num = (s) => {
  const n = parseFloat(stripTags(s).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

// Parse the <table id="t2"> rows of these two ranking pages.
// QoL columns: rank, city, qol, purchasingPower, safety, healthCare,
//   costOfLiving, priceToIncome, traffic, pollution, climate
// Crime columns: rank, city, crime, safety
function parseTable(html, kind) {
  const start = html.indexOf('<table id="t2"');
  if (start === -1) return [];
  const end = html.indexOf("</table>", start);
  const table = html.slice(start, end);
  const out = [];
  for (const row of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
    if (cells.length < 4) continue;
    const name = stripTags(cells[1]);
    if (!name || /^city$/i.test(name)) continue;
    if (kind === "quality") {
      out.push({
        name,
        qualityOfLifeIndex: num(cells[2]),
        purchasingPowerIndex: num(cells[3]),
        safetyIndex: num(cells[4]),
        healthCareIndex: num(cells[5]),
        costOfLivingIndex: num(cells[6]),
        priceToIncome: num(cells[7]),
        trafficIndex: num(cells[8]),
        pollutionIndex: num(cells[9]),
        climateIndex: num(cells[10]),
      });
    } else {
      out.push({ name, crimeIndex: num(cells[2]), safetyIndex: num(cells[3]) });
    }
  }
  return out;
}

// Country-level QoL table: rank, country, qol, purchasingPower, safety, ...
function parseCountryTable(html) {
  const out = [];
  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
    if (cells.length < 11) continue;
    const country = stripTags(cells[1]);
    const qol = num(cells[2]);
    if (!country || qol == null) continue;
    out.push({
      country,
      qualityOfLifeIndex: qol,
      safetyIndex: num(cells[4]),
      healthCareIndex: num(cells[5]),
      costOfLivingIndex: num(cells[6]),
      trafficIndex: num(cells[8]),
      pollutionIndex: num(cells[9]),
      climateIndex: num(cells[10]),
    });
  }
  return out;
}

async function fetchCountries(url, file) {
  const res = await get(url, { retries: 2, timeout: 60000 });
  if (!res.ok) {
    process.exitCode = await failedFetch(file, `returned ${res.status || res.error}`);
    return;
  }
  const countries = parseCountryTable(res.body);
  if (!countries.length) {
    process.exitCode = await failedFetch(file, "country table had 0 rows");
    return;
  }
  const data = JSON.parse(await import("node:fs/promises").then((fs) => fs.readFile(`data/${file}.json`, "utf8")));
  data.countries = countries;
  const changed = await writeIfChanged(`data/${file}.json`, data);
  log(`${file}: ${changed ? "updated" : "unchanged"} ${countries.length} country rows`);
}

async function fetchTable(url, kind, file) {
  const res = await get(url, { retries: 2, timeout: 60000 });
  if (!res.ok) {
    process.exitCode = await failedFetch(file, `returned ${res.status || res.error}`);
    return;
  }
  log(`${file}: fetched via ${res.via || "direct"} (${res.body.length} bytes)`);
  const cities = parseTable(res.body, kind);
  if (!cities.length) {
    process.exitCode = await failedFetch(file, `table had ${cities.length} rows`);
    return;
  }
  // Keep cities added by backfill-indices.mjs; ranking rows win on conflict.
  const fs = await import("node:fs/promises");
  let prev = { cities: [] };
  try {
    prev = JSON.parse(await fs.readFile(`data/${file}.json`, "utf8"));
  } catch {}
  const byName = new Map((prev.cities || []).map((r) => [r.name.toLowerCase(), r]));
  for (const r of cities) byName.set(r.name.toLowerCase(), r);
  const merged = [...byName.values()];

  const changed = await writeIfChanged(`data/${file}.json`, {
    generatedAt: new Date().toISOString(),
    count: merged.length,
    cities: merged,
  });
  log(`${file}: ${changed ? "wrote" : "unchanged"} ${merged.length} cities (${cities.length} ranked + ${merged.length - cities.length} backfilled)`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.force && (await freshEnough("quality", args["max-age-hours"] ?? 20)) && (await freshEnough("crime", args["max-age-hours"] ?? 20))) return;

  await fetchTable("https://www.numbeo.com/quality-of-life/rankings.jsp", "quality", "quality");
  await fetchTable("https://www.numbeo.com/crime/rankings_current.jsp", "crime", "crime");
  await fetchCountries("https://www.numbeo.com/quality-of-life/rankings_by_country.jsp", "quality");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
