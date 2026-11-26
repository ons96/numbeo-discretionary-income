// Joins everything we know about each city into data/cities.json:
//
//   data/bulk.json   one-shot table: salary + the four rents (~570 cities)
//   data/pages.json   per-city pages: single-person living costs, fresher rents
//   data/lists.json   the full country/city list, so empty cities still exist
//
//   node scraper/merge.mjs

import { readJson, writeIfChanged } from "./lib/store.mjs";

const slugify = (s) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

async function main() {
  const bulk = await readJson("data/bulk.json", { cities: [] });
  const minwage = await readJson("data/minwage.json", { countries: [] });
  const minWageByCountry = new Map((minwage.countries || []).map((r) => [r.country, r]));
  const subnat = await readJson("data/minwage-subnational.json", { countries: {} });
  const quality = await readJson("data/quality.json", { cities: [] });
  const crime = await readJson("data/crime.json", { cities: [] });
  const qualityByName = new Map((quality.cities || []).map((r) => [r.name.toLowerCase(), r]));
  const qualityByCountry = new Map((quality.countries || []).map((r) => [r.country.toLowerCase(), r]));
  const crimeByName = new Map((crime.cities || []).map((r) => [r.name.toLowerCase(), r]));
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
    minWage: null,
    qualityOfLifeIndex: null,
    safetyIndex: null,
    crimeIndex: null,
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

  // City pages crawled from city_result.jsp carry no /in/ slug, so match those
  // by the country||city key instead of dropping them.
  const byKey = new Map([...bySlug.values()].map((r) => [`${r.country}||${r.city}`.toLowerCase(), r]));
  for (const p of pages.cities || []) {
    const rec = p.slug
      ? touch(p.slug)
      : byKey.get(String(p.key || `${p.country}||${p.city}`).toLowerCase());
    if (!rec) continue;
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

  // A state / province / canton rate beats the national one where we have it.
  function localMinWage(rec) {
    const block = rec.country ? subnat.countries?.[rec.country] : null;
    if (!block) return null;
    const city = rec.city || "";
    const make = (value, scope) =>
      value == null ? null : {
        value, currency: block.currency, period: "hour",
        effectivePeriod: block.effective, source: block.source, scope,
      };
    if (block.cityRates?.[city] != null) return make(block.cityRates[city], "city");
    if (block.cities?.[city] != null) return make(block.cities[city], "city");
    const region = block.cityRegion?.[city] || (city.match(/,\s*([A-Z]{2})$/) || [])[1];
    if (region && block.regions?.[region] != null) {
      const scope = rec.country === "United States" ? "state" : rec.country === "Canada" ? "province" : "canton";
      return make(block.regions[region], scope);
    }
    if (block.default != null) {
      const scope = rec.country === "United States" ? "state" : "country";
      return make(block.default, scope);
    }
    return null;
  }

  // A country row is only usable when it is a national statutory rate. The API
  // also answers with ILO aggregates - a regional average, a sectoral average,
  // or a "national floor" - and those must not be shown as the wage an employer
  // owes. Switzerland has no federal minimum wage, so its regional average would
  // otherwise put a fabricated 5067 USD/month on Zurich. Rows crawled before the
  // qualifier was recorded have no basis; keep them only when the measure text
  // does not betray an aggregate.
  const isNational = (r) => {
    if (!r || r.value == null) return false;
    if (r.basis) return r.basis === "national";
    return !/regional|sectoral|floor/i.test(String(r.measure || ""));
  };

  for (const rec of bySlug.values()) {
    const country = rec.country ? minWageByCountry.get(rec.country) : null;
    // A subnational rate is a real statutory rate, so it wins; the country row
    // is the fallback and only when it is national.
    const local = localMinWage(rec);
    if (local) rec.minWage = local;
    else if (isNational(country)) rec.minWage = country;
    else rec.minWage = null;
    const key = rec.city && rec.country ? `${rec.city}, ${rec.country}`.toLowerCase() : null;
    const q = key ? qualityByName.get(key) : null;
    const c = key ? crimeByName.get(key) : null;
    const qc = rec.country ? qualityByCountry.get(rec.country.toLowerCase()) : null;
    rec.qualityOfLifeIndex = q ? q.qualityOfLifeIndex : qc ? qc.qualityOfLifeIndex : null;
    rec.qualityEstimated = !q && !!qc;
    rec.safetyIndex = c ? c.safetyIndex : q ? q.safetyIndex : null;
    rec.crimeIndex = c ? c.crimeIndex : null;
  }

  const cities = [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
  const withData = cities.filter((c) => c.salary != null || c.rent.oneBedCentre != null).length;

  // Failsafe: never replace a good dataset with a collapsed one. A blocked or
  // empty scrape yields a short list; keep yesterday's file instead.
  const prev = await readJson("data/cities.json", { count: 0 });
  if ((prev.count || 0) >= 50 && cities.length < prev.count * 0.8) {
    console.log(`::error::merge produced ${cities.length} cities, down from ${prev.count} - keeping data/cities.json`);
    process.exitCode = 1;
    return;
  }
  if (!withData) {
    console.log(`::error::merge produced 0 cities with salary or rent - keeping data/cities.json`);
    process.exitCode = 1;
    return;
  }

  const changed = await writeIfChanged("data/cities.json", {
    generatedAt: new Date().toISOString(),
    count: cities.length,
    withData,
    cities,
  });

  console.log(
    `data/cities.json ${changed ? "updated" : "unchanged"}: ${cities.length} cities, ` +
      `${withData} with salary or rent, ` +
      `${cities.filter((c) => c.singleExpenses != null).length} with living-cost data`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
