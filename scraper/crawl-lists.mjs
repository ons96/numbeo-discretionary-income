// Builds data/lists.json: every country numbeo knows about, with every city in
// each country's dropdown, plus the current index rankings table.
//
//   node scraper/crawl-lists.mjs

import { writeFile, mkdir } from "node:fs/promises";
import { get } from "./lib/http.mjs";
import { parseCountries, parseCityList, parseRankings } from "./lib/parse.mjs";

const BASE = "https://www.numbeo.com";
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function main() {
  log("fetching country list");
  const landing = await get(`${BASE}/cost-of-living/`);
  if (!landing.ok) throw new Error(`landing page failed: HTTP ${landing.status}`);

  const countries = parseCountries(landing.body);
  log(`${countries.length} countries`);

  const out = [];
  let total = 0;
  for (let i = 0; i < countries.length; i++) {
    const name = countries[i];
    const url = `${BASE}/cost-of-living/country_result.jsp?country=${encodeURIComponent(name)}`;
    const res = await get(url);
    let cities = [];
    if (res.ok) cities = parseCityList(res.body);
    if (!res.ok) log(`  ! ${name}: HTTP ${res.status}`);
    total += cities.length;
    out.push({ name, cities });
    if ((i + 1) % 20 === 0 || i === countries.length - 1) {
      log(`  ${i + 1}/${countries.length} countries, ${total} cities so far`);
    }
  }

  log("fetching index rankings");
  const rank = await get(`${BASE}/cost-of-living/rankings_current.jsp`);
  const indices = rank.ok ? parseRankings(rank.body) : [];
  log(`  ${indices.length} ranked cities`);

  await mkdir("data", { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    countries: out,
    totalCities: total,
  };
  await writeFile("data/lists.json", JSON.stringify(payload, null, 1));
  await writeFile("data/indices.json", JSON.stringify({ generatedAt: new Date().toISOString(), cities: indices }, null, 1));
  log(`wrote data/lists.json (${out.length} countries, ${total} cities) and data/indices.json`);

  for (const c of out.slice(0, 5)) log(`  ${c.name}: ${c.cities.length}`);
  const biggest = [...out].sort((a, b) => b.cities.length - a.cities.length).slice(0, 5);
  log("largest: " + biggest.map((c) => `${c.name}(${c.cities.length})`).join(", "));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
