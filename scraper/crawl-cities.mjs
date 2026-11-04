// Fetches city pages and writes a shard file.
//
//   node scraper/crawl-cities.mjs --shard=0 --shards=8
//   node scraper/crawl-cities.mjs --limit=20 --out=/tmp/test.json
//
// Existing records in data/cities.json are reused when they are younger than
// --max-age-days, so a weekly run only refetches what has gone stale.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { get } from "./lib/http.mjs";
import { parseCityPage } from "./lib/parse.mjs";

const BASE = "https://www.numbeo.com";
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : "true"];
  })
);

const SHARDS = Number(args.shards || 1);
const SHARD = Number(args.shard || 0);
const MAX_AGE_DAYS = Number(args["max-age-days"] || 7);
const LIMIT = args.limit ? Number(args.limit) : Infinity;
const BUDGET = args.budget ? Number(args.budget) : Infinity;
const OUT = args.out || (SHARDS > 1 ? `data/shard-${SHARD}.json` : "data/cities.json");
const REUSE = args.reuse || "data/cities.json";
const ONLY_COUNTRIES = args.countries ? args.countries.split(",").map((s) => s.trim()).filter(Boolean) : null;
const NICE = "NumbeoDiscretionaryIncome/1.0 (+https://github.com/ons96/numbeo-discretionary-income)";

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0);
}

const key = (country, city) => `${country}||${city}`;

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function main() {
  const lists = await readJson("data/lists.json", null);
  if (!lists) throw new Error("data/lists.json missing - run crawl-lists.mjs first");

  let pairs = [];
  for (const c of lists.countries) {
    if (ONLY_COUNTRIES && !ONLY_COUNTRIES.includes(c.name)) continue;
    for (const city of c.cities) pairs.push({ country: c.name, city });
  }

  if (SHARDS > 1) {
    pairs = pairs.filter((p) => hash(key(p.country, p.city)) % SHARDS === SHARD);
  }

  const existing = await readJson(REUSE, { cities: [] });
  const cache = new Map((existing.cities || []).map((r) => [r.key || key(r.country, r.city), r]));

  const cutoff = Date.now() - MAX_AGE_DAYS * 86400000;
  const todo = [];
  for (const p of pairs) {
    const hit = cache.get(key(p.country, p.city));
    const fresh = hit && hit.ok && hit.scrapedAt && Date.parse(hit.scrapedAt) > cutoff;
    if (!fresh) todo.push({ ...p, last: hit && hit.scrapedAt ? Date.parse(hit.scrapedAt) : -1 });
  }

  // never scraped first, then whatever has been waiting longest
  todo.sort((a, b) => a.last - b.last || a.country.localeCompare(b.country));

  const budgeted = todo.slice(0, Number.isFinite(BUDGET) ? BUDGET : todo.length);

  log(
    `shard ${SHARD}/${SHARDS}: ${pairs.length} cities, ${pairs.length - todo.length} fresh, ` +
      `${todo.length} stale, fetching ${budgeted.length} this run`
  );

  const records = [];
  let done = 0;
  let failures = 0;
  let streak = 0;
  let blocked = false;
  const started = Date.now();
  const queue = budgeted.slice(0, Number.isFinite(LIMIT) ? LIMIT : budgeted.length);

  async function worker() {
    while (queue.length) {
      const p = queue.shift();
      const url =
        `${BASE}/cost-of-living/city_result.jsp?country=${encodeURIComponent(p.country)}` +
        `&city=${encodeURIComponent(p.city)}&displayCurrency=USD`;
      const res = await get(url);
      done++;
      let rec;
      if (res.ok && res.body.length > 2000) {
        const parsed = parseCityPage(res.body, res.url);
        const slug = (res.url.split("/in/")[1] || "").split("?")[0] || null;
        rec = {
          key: key(p.country, p.city),
          country: p.country,
          city: p.city,
          name: parsed.city || p.city,
          slug,
          ok: true,
          scrapedAt: new Date().toISOString(),
          dataDate: parsed.dataDate,
          rent: parsed.rent,
          salary: parsed.salary,
          singleExpenses: parsed.singleExpenses,
          family4Expenses: parsed.family4Expenses,
          hasData: parsed.hasData,
        };
        streak = 0;
      } else {
        failures++;
        streak++;
        rec = {
          key: key(p.country, p.city),
          country: p.country,
          city: p.city,
          ok: false,
          status: res.status,
          error: res.error || `HTTP ${res.status}`,
          scrapedAt: new Date().toISOString(),
        };
        log(`  ! ${p.country} / ${p.city}: ${rec.error}`);
        if (streak >= 12) {
          console.log("::warning::12 consecutive failures - looks like we are rate limited or blocked; stopping this shard early");
          blocked = true;
          queue.length = 0;
          return;
        }
      }
      records.push(rec);

      if (done % 25 === 0 || queue.length === 0) {
        const elapsed = (Date.now() - started) / 1000;
        const rate = done / elapsed;
        const eta = Math.round(queue.length / rate / 60);
        log(`  ${done}/${done + queue.length} (${failures} failed) ${rate.toFixed(1)}/s eta ${eta}m`);
      }
    }
  }

  const workers = Array.from({ length: Number(process.env.CONCURRENCY || 2) }, worker);
  await Promise.all(workers);

  // keep the fresh ones we skipped too, so a shard file is self-contained
  const fetchedKeys = new Set(records.map((r) => r.key));
  for (const p of pairs) {
    const k = key(p.country, p.city);
    if (fetchedKeys.has(k)) continue;
    const hit = cache.get(k);
    if (hit) records.push(hit);
  }
  records.sort((a, b) => a.key.localeCompare(b.key));

  await mkdir("data", { recursive: true });
  await writeFile(
    OUT,
    JSON.stringify({ generatedAt: new Date().toISOString(), header: NICE, count: records.length, cities: records })
  );
  log(`wrote ${OUT}: ${records.length} records, ${failures} failures${blocked ? " (stopped early: blocked)" : ""}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
