// One request, every city numbeo has a complete dataset for.
//
//   node scraper/crawl-bulk.mjs
//
// prices_by_city.jsp accepts several itemId parameters and returns a single
// table with all of them side by side, so salary + the four rents for ~570
// cities arrive in one page instead of 570 requests.

import { writeFile, mkdir } from "node:fs/promises";
import { get } from "./lib/http.mjs";
import { parseBulkTable } from "./lib/parse.mjs";

const ITEMS = {
  26: "rent1brCentre",
  27: "rent1brOutside",
  28: "rent3brCentre",
  29: "rent3brOutside",
  105: "salary",
};
const ORDER = Object.keys(ITEMS);

const url =
  "https://www.numbeo.com/cost-of-living/prices_by_city.jsp" +
  ORDER.map((id) => `&itemId=${id}`).join("") +
  "&displayCurrency=USD";

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function main() {
  log(`fetching ${url}`);
  const res = await get(url, { retries: 2, timeout: 90000 });
  if (!res.ok) {
    console.error(`::error::prices_by_city returned ${res.status || res.error}`);
    process.exit(1);
  }

  const rows = parseBulkTable(res.body);
  log(`${rows.length} cities in the table`);

  const cities = rows.map((r) => {
    const rec = { slug: r.slug, name: r.name, city: r.city, country: r.country };
    ORDER.forEach((id, i) => {
      rec[ITEMS[id]] = r.values[i] ?? null;
    });
    if (!rec.country) rec.country = "—";
    return rec;
  });

  await mkdir("data", { recursive: true });
  await writeFile(
    "data/bulk.json",
    JSON.stringify({ generatedAt: new Date().toISOString(), source: url, count: cities.length, cities }, null, 0)
  );

  const withSalary = cities.filter((c) => c.salary != null).length;
  const withRent = cities.filter((c) => c.rent1brCentre != null || c.rent3brCentre != null).length;
  log(`wrote data/bulk.json: ${cities.length} cities, ${withSalary} with a salary, ${withRent} with rent`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
