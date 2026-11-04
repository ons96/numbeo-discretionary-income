// Joins everything we know about each city into data/cities.json:
//
//   data/bulk.json   one-shot table: salary + the four rents (~570 cities)
//   data/pages.json   per-city pages: single-person living costs, fresher rents
//   data/lists.json   the full country/city list, so empty cities still exist
//
//   node scraper/merge.mjs

import { readFile, writeFile } from "node:fs/promises";

const slugify = (s) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function main() {
  const bulk = await readJson("data/bulk.json", { cities: [] });
  const pages = await readJson("data/pages.json", { cities: [] });
  const lists = await readJson("data/lists.json", { countries: [] });

  const bySlug = new Map();

  const blank = (slug) => ({
    slug,
    name: null,
    city: null,
    country: null,
    rent: { oneBedCentre: null, oneBedOutside: null, threeBedCentre: null, threeBedOutside: null },
    salary: null,
    singleExpenses: null,
    family4Expenses: null,
    ok: true,
    dataDate: null,
    scrapedAt: null,
    sources: [],
  });

  const touch = (slug) => {
    if (!bySlug.has(slug)) bySlug.set(slug, blank(slug));
    return bySlug.get(slug);
  };

  for (const c of bulk.cities || []) {
    const rec = touch(c.slug);
    rec.name = c.name;
    rec.city = c.city;
    rec.country = c.country;
    rec.rent = {
      oneBedCentre: c.rent1brCentre ?? null,
      oneBedOutside: c.rent1brOutside ?? null,
      threeBedCentre: c.rent3brCentre ?? null,
      threeBedOutside: c.rent3brOutside ?? null,
    };
    rec.salary = c.salary ?? null;
    rec.scrapedAt = bulk.generatedAt;
    rec.sources.push("bulk");
  }

  for (const p of pages.cities || []) {
    if (!p.slug) continue;
    const rec = touch(p.slug);
    const newer = !rec.scrapedAt || Date.parse(p.scrapedAt || 0) >= Date.parse(rec.scrapedAt);
    if (!rec.name) {
      rec.name = p.name || p.city;
      rec.city = p.city;
      rec.country = p.country;
    }
    if (p.ok === false) {
      rec.ok = false;
      continue;
    }
    // a city page carries the living-cost estimate, and is the fresher source
    if (p.singleExpenses != null) rec.singleExpenses = p.singleExpenses;
    if (p.family4Expenses != null) rec.family4Expenses = p.family4Expenses;
    if (newer) {
      const r = p.rent || {};
      if (r.oneBedCentre != null) rec.rent.oneBedCentre = r.oneBedCentre;
      if (r.oneBedOutside != null) rec.rent.oneBedOutside = r.oneBedOutside;
      if (r.threeBedCentre != null) rec.rent.threeBedCentre = r.threeBedCentre;
      if (r.threeBedOutside != null) rec.rent.threeBedOutside = r.threeBedOutside;
      if (p.salary != null) rec.salary = p.salary;
      if (p.dataDate) rec.dataDate = p.dataDate;
    }
    rec.sources.push("page");
  }

  // every city numbeo lists, even the ones we have nothing for yet
  for (const country of lists.countries || []) {
    for (const city of country.cities || []) {
      const slug = slugify(city);
      if (bySlug.has(slug)) continue;
      const rec = blank(slug);
      rec.name = city;
      rec.city = city;
      rec.country = country.name;
      rec.sources.push("list");
      bySlug.set(slug, rec);
    }
  }

  const cities = [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
  const withData = cities.filter((c) => c.salary != null || c.rent.oneBedCentre != null).length;

  await writeFile(
    "data/cities.json",
    JSON.stringify({ generatedAt: new Date().toISOString(), count: cities.length, withData, cities })
  );

  console.log(
    `data/cities.json: ${cities.length} cities, ${withData} with salary or rent, ` +
      `${cities.filter((c) => c.singleExpenses != null).length} with living-cost data`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
