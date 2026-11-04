// Quick connectivity check against numbeo.com.
//   node scraper/probe.mjs
// Prints the status for a couple of pages so a blocked run is obvious fast.

import { get } from "./lib/http.mjs";

const urls = [
  "https://www.numbeo.com/cost-of-living/",
  "https://www.numbeo.com/cost-of-living/country_result.jsp?country=Canada",
  "https://www.numbeo.com/cost-of-living/in/Toronto?displayCurrency=USD",
];

for (const url of urls) {
  const res = await get(url, { retries: 1 });
  const blocked = res.status === 429 || res.status === 403;
  console.log(`${res.status || "ERR"} ${blocked ? "BLOCKED " : ""}${url} ${res.body ? `(${res.body.length} bytes)` : ""}`);
}
