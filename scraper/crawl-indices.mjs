// One request: numbeo's current index table (cost of living, rent, groceries,
// restaurant, purchasing power) for the ~575 ranked cities.
//
//   node scraper/crawl-indices.mjs [--max-age-hours=20] [--force]

import { writeIfChanged, parseArgs, freshEnough, failedFetch, suspiciouslySmall } from "./lib/store.mjs";
import { get } from "./lib/http.mjs";
import { parseRankings } from "./lib/parse.mjs";

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.force && (await freshEnough("indices", args["max-age-hours"] ?? 20))) return;

  const url = "https://www.numbeo.com/cost-of-living/rankings_current.jsp";
  const res = await get(url, { retries: 2, timeout: 60000 });
  if (!res.ok) {
    process.exitCode = await failedFetch("indices", `rankings returned ${res.status || res.error}`);
    return;
  }
  log(`fetched via ${res.via || "direct"} (${res.body.length} bytes)`);

  const cities = parseRankings(res.body);
  if (!cities.length || (await suspiciouslySmall("indices", cities.length))) {
    process.exitCode = await failedFetch("indices", `the index table had ${cities.length} rows`);
    return;
  }

  const changed = await writeIfChanged("data/indices.json", {
    generatedAt: new Date().toISOString(),
    count: cities.length,
    cities,
  });
  log(`${changed ? "wrote" : "unchanged"} data/indices.json: ${cities.length} cities`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
