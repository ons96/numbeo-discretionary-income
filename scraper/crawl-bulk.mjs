// One request, every city numbeo has a complete dataset for.
//
//   node scraper/crawl-bulk.mjs [--max-age-hours=20] [--force]
//
// prices_by_city.jsp accepts several itemId parameters and returns a single
// table with all of them side by side, so salary + the four rents for ~570
// cities arrive in one page instead of 570 requests.
//
// If the fetch fails or returns a shrunken table, the previous data/bulk.json
// is left untouched (see lib/store.mjs) - the site keeps working on cached
// numbers instead of emptying out.

import { writeIfChanged, readJson, parseArgs, freshEnough, failedFetch, suspiciouslySmall, ageDays } from "./lib/store.mjs";
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
  "https://www.numbeo.com/cost-of-living/prices_by_city.jsp?" +
  ORDER.map((id) => `itemId=${id}`).join("&") +
  "&displayCurrency=USD";

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.force && (await freshEnough("bulk", args["max-age-hours"] ?? 20))) return;

  log(`fetching ${url}`);
  const res = await get(url, { retries: 2, timeout: 90000 });
  if (!res.ok) {
    process.exitCode = await failedFetch("bulk", `prices_by_city returned ${res.status || res.error}`);
    return;
  }

  log(`fetched via ${res.via || "direct"} (${res.body.length} bytes)`);

  const rows = parseBulkTable(res.body);
  log(`${rows.length} cities in the table`);
  if (!rows.length || (await suspiciouslySmall("bulk", rows.length))) {
    process.exitCode = await failedFetch("bulk", `the table had ${rows.length} usable rows`);
    return;
  }

  const cities = rows.map((r) => {
    const rec = { slug: r.slug, name: r.name, city: r.city, country: r.country };
    ORDER.forEach((id, i) => {
      rec[ITEMS[id]] = r.values[i] ?? null;
    });
    if (!rec.country) rec.country = "—";
    return rec;
  });

  const changed = await writeIfChanged("data/bulk.json", {
    generatedAt: new Date().toISOString(),
    source: url,
    count: cities.length,
    cities,
  });

  const prev = await readJson("data/bulk.json", {});
  const withSalary = cities.filter((c) => c.salary != null).length;
  const withRent = cities.filter((c) => c.rent1brCentre != null || c.rent3brCentre != null).length;
  log(
    `${changed ? "wrote" : "unchanged"} data/bulk.json: ${cities.length} cities, ` +
      `${withSalary} with a salary, ${withRent} with rent` +
      (prev.generatedAt ? ` (cached since ${ageDays(prev.generatedAt).toFixed(1)} d)` : "")
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
