// One request: numbeo's current index table (cost of living, rent, groceries,
// restaurant, purchasing power) for the ~575 ranked cities.
//
//   node scraper/crawl-indices.mjs

import { writeFile, mkdir } from "node:fs/promises";
import { get } from "./lib/http.mjs";
import { parseRankings } from "./lib/parse.mjs";

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function main() {
  const url = "https://www.numbeo.com/cost-of-living/rankings_current.jsp";
  const res = await get(url, { retries: 2, timeout: 60000 });
  if (!res.ok) {
    console.error(`::error::rankings returned ${res.status || res.error}`);
    process.exit(1);
  }
  const cities = parseRankings(res.body);
  await mkdir("data", { recursive: true });
  await writeFile("data/indices.json", JSON.stringify({ generatedAt: new Date().toISOString(), count: cities.length, cities }));
  log(`wrote data/indices.json: ${cities.length} cities`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
