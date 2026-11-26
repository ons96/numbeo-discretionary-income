// Backfills quality-of-life / crime / safety indices for cities missing from the
// ranking tables by reading each city's own Numbeo page.
//
//   node scraper/backfill-indices.mjs [--limit=N]
//
// Ranking pages only cover the top N cities. A city that has a Numbeo page but
// is not ranked still shows "Quality of Life Index: X" and "Crime Index: X" on
// /quality-of-life/in/<slug> and /crime/in/<slug>. Cities with too little data
// return a stub page with no "Index:" line and are skipped.

import { readFile, writeFile } from "node:fs/promises";
import { get } from "./lib/http.mjs";

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const GAP_MS = 1200;

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const one = (s, label) => {
  const m = s.match(new RegExp(label + ":\\s*([0-9]+(?:\\.[0-9]+)?)"));
  return m ? parseFloat(m[1]) : null;
};

async function fetchPage(url) {
  const res = await get(url, { retries: 1, timeout: 45000 });
  return res.ok ? res.body : "";
}

async function main() {
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : Infinity;

  const cities = (await readJson("data/cities.json", { cities: [] })).cities || [];
  const quality = await readJson("data/quality.json", { cities: [] });
  const crime = await readJson("data/crime.json", { cities: [] });

  const qBy = new Map((quality.cities || []).map((r) => [r.name.toLowerCase(), r]));
  const cBy = new Map((crime.cities || []).map((r) => [r.name.toLowerCase(), r]));

  const todo = cities.filter((c) => {
    if (!c.city || !c.country || !c.slug) return false;
    const key = `${c.city}, ${c.country}`.toLowerCase();
    return !qBy.has(key) || !cBy.has(key);
  });
  log(`${cities.length} cities, ${todo.length} missing an index, limit ${limit}`);
  if (!todo.length) return;

  let done = 0;
  let addedQ = 0;
  let addedC = 0;

  for (const c of todo) {
    if (done >= limit) break;
    done++;
    const key = `${c.city}, ${c.country}`.toLowerCase();
    const name = `${c.city}, ${c.country}`;
    const slug = encodeURIComponent(c.slug);

    if (!qBy.has(key)) {
      const html = await fetchPage(`https://www.numbeo.com/quality-of-life/in/${slug}`);
      const t = html ? text(html) : "";
      const qol = t ? one(t, "Quality of Life Index") : null;
      if (qol != null) {
        const rec = {
          name,
          qualityOfLifeIndex: qol,
          safetyIndex: one(t, "Safety Index"),
          purchasingPowerIndex: one(t, "Purchasing Power Index"),
          healthCareIndex: one(t, "Health Care Index"),
          costOfLivingIndex: one(t, "Cost of Living Index"),
          trafficIndex: one(t, "Traffic Commute Time Index"),
          pollutionIndex: one(t, "Pollution Index"),
          climateIndex: one(t, "Climate Index"),
          backfilled: true,
        };
        quality.cities.push(rec);
        qBy.set(key, rec);
        addedQ++;
      }
      await new Promise((r) => setTimeout(r, GAP_MS));
    }

    if (!cBy.has(key)) {
      const html = await fetchPage(`https://www.numbeo.com/crime/in/${slug}`);
      const t = html ? text(html) : "";
      const cIdx = t ? one(t, "Crime Index") : null;
      if (cIdx != null) {
        const rec = { name, crimeIndex: cIdx, safetyIndex: one(t, "Safety Index"), backfilled: true };
        crime.cities.push(rec);
        cBy.set(key, rec);
        addedC++;
      }
      await new Promise((r) => setTimeout(r, GAP_MS));
    }

    if (done % 20 === 0) log(`${done}/${Math.min(todo.length, limit)} checked, +${addedQ} qol, +${addedC} crime`);
  }

  quality.count = quality.cities.length;
  crime.count = crime.cities.length;
  quality.generatedAt = quality.generatedAt || new Date().toISOString();
  crime.generatedAt = crime.generatedAt || new Date().toISOString();
  await writeFile("data/quality.json", JSON.stringify(quality, null, 2));
  await writeFile("data/crime.json", JSON.stringify(crime, null, 2));
  log(`done: checked ${done}, +${addedQ} quality, +${addedC} crime`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
