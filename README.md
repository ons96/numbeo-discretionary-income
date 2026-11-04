# Where your salary goes furthest

A scraper + static site that answers one question: **in which cities does an
average net salary leave the most money over at the end of the year?**

Live site: <https://ons96.github.io/numbeo-discretionary-income/>

Every day a GitHub Action crawls [Numbeo](https://www.numbeo.com/cost-of-living/),
recomputes the ranking and redeploys the page. Free runner minutes (public repo),
free hosting (GitHub Pages), no server, no database, no API keys.

---

## The calculation

All amounts are Numbeo's own city figures, fetched in **USD** and converted in the
browser to whichever currency you pick.

| Quantity | Where it comes from |
| --- | --- |
| `salary` | “Average Monthly Net Salary (After Tax)” |
| `expenses` | “estimated monthly costs for a single person, excluding rent” |
| `rent1brCentre` / `rent1brOutside` | “1 Bedroom Apartment in / outside of City Centre” |
| `rent3brCentre` / `rent3brOutside` | “3 Bedroom Apartment in / outside of City Centre” |

Four rent scenarios, each a yearly figure:

```
own 1-bed, centre      salary*12 - expenses*12 - rent1brCentre*12
own 1-bed, outside     salary*12 - expenses*12 - rent1brOutside*12
room in 3-bed, centre  salary*12 - expenses*12 - (rent3brCentre/3)*12
room in 3-bed, outside salary*12 - expenses*12 - (rent3brOutside/3)*12
```

A row keeps its city even when a field is missing — the value is just shown as
`–`, so a city that gains data later appears without any code change.

### Caveats worth keeping in mind

* Numbeo is crowd-sourced. Salary figures skew towards white-collar, English-speaking
  contributors, and a city with five entries is noise.
* “Net salary” is Numbeo's own after-tax estimate, not a tax engine.
* Living costs exclude rent by definition, so rent is added back explicitly.
* Currency conversion is a daily ECB/er-api snapshot, not the rate you would get.

---

## How it runs

```
scraper/crawl-lists.mjs   235 country pages -> every city in every dropdown
                          + the current index rankings (1 page)
scraper/crawl-cities.mjs  one page per city, sharded, budgeted, resumable
scraper/merge.mjs         shard files + previous data -> data/cities.json
scraper/build.mjs         + FX -> site/data.json and site/data.csv
site/                     static page, no build step
```

`.github/workflows/scrape.yml` runs daily:

1. `lists` — refreshes the country/city list if it is older than 30 days.
2. `crawl` — 4 shards in parallel, each fetching at most `budget` cities
   (default 400), oldest data first, skipping anything younger than
   `max_age_days` (default 7).
3. `publish` — merges, computes, commits `data/` and `site/data.json|.csv`,
   deploys `site/` to Pages.

### Being a good citizen (and not getting banned)

Numbeo answers a burst of requests with `429` plus a `Retry-After` a month out,
and it is per IP. So:

* one request at a time per shard, ~1 s apart (`CONCURRENCY`, `MIN_GAP_MS`);
* a per-run budget, so a daily run refreshes a slice rather than the whole world;
* a shard stops itself after 12 consecutive failures instead of hammering;
* data is cached in `data/cities.json`, so nothing is fetched twice.

If every shard comes back blocked, run `node scraper/probe.mjs` to confirm, then
wait out the `Retry-After` — retrying sooner only extends the ban.

---

## Running it locally

Node 20+, no dependencies.

```bash
node scraper/probe.mjs                 # is numbeo reachable from here?
node scraper/crawl-lists.mjs           # ~235 requests, builds data/lists.json
node scraper/crawl-cities.mjs --limit=20   # smoke test
node scraper/merge.mjs
node scraper/build.mjs
python3 -m http.server -d site 8000    # or any static server
```

Useful flags for `crawl-cities.mjs`:

| flag | meaning |
| --- | --- |
| `--shard=N --shards=M` | only this slice of cities |
| `--budget=N` | stop after N fetches this run |
| `--max-age-days=N` | refetch only what is older than this |
| `--countries=Canada,Japan` | restrict to countries |
| `--limit=N` | hard cap, for testing |
| `--out=path.json` | where to write (default `data/shard-N.json`) |

Environment: `CONCURRENCY` (default 2) and `MIN_GAP_MS` (default 900).

---

## Data files

* `data/lists.json` — countries, their cities, scrape timestamp.
* `data/indices.json` — Numbeo's index table (cost of living, rent, groceries,
  restaurant, purchasing power) for the ~575 ranked cities, matched by slug.
* `data/cities.json` — the master record set, one entry per country+city.
* `site/data.json` — compact columnar payload the page loads.
* `site/data.csv` — same data, one row per city, all four scenarios.

Records that fail keep `ok: false` with the HTTP status, so a blocked run is
visible in the data rather than silently dropping cities.
