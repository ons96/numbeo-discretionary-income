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

The expensive-looking part turned out to be cheap: `prices_by_city.jsp` takes
several `itemId` parameters and returns **one table with every city** that has a
complete dataset — salary and the four rents side by side. So the whole core
dataset is a single request, and the site is two:

```
scraper/crawl-bulk.mjs     1 request -> data/bulk.json    (salary + 4 rents, ~570 cities)
scraper/crawl-indices.mjs  1 request -> data/indices.json (cost of living / rent / pp indices)
scraper/crawl-lists.mjs   235 requests -> the full country/city list (monthly, optional)
scraper/crawl-cities.mjs  optional: one page per city, for real living-cost figures
scraper/merge.mjs         joins them -> data/cities.json
scraper/build.mjs         + FX -> site/data.json and site/data.csv
site/                     static page, no build step
```

Two workflows:

* **Crawl** (manual) fetches the data and commits it. It needs a residential IP:
  numbeo answers datacenter ranges with `503 Access Forbidden`, so GitHub's
  hosted runners cannot do it. Set the repo variable `CRAWL_RUNNER` to a
  self-hosted runner's label, or run `scripts/vps-crawl.sh` from a home machine.
* **Publish** (on every push) rebuilds and deploys the page.

### Living costs

The bulk table has no "single person living costs" column, so those get crawled
per city when you have the patience (`crawl-cities.mjs --budget=200`). Every
other city shows **≈** and uses an estimate: cost-of-living index / 100 × the
New York basket, with the anchor taken from the median of the cities that do
have real figures. The estimates get better as pages arrive.

### Being a good citizen (and not getting banned)

* two requests per refresh, one at a time, ~1.5 s apart;
* the per-city pass is budgeted and resumable, nothing is fetched twice;
* a run stops itself the moment numbeo answers with a far-future `Retry-After`
  instead of retrying into a longer ban.

If it does stop, `node scraper/probe.mjs` shows why.

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

---

## Wait — why isn't the crawl in the Action?

Because it can't be. numbeo.com answers requests from datacenter IP ranges
(GitHub's hosted runners are Azure) with **503 Access Forbidden** — with or
without cookies, any user agent. From a residential connection the same URLs
return 200. It is an IP-class block, not a rate limit, so no header trick gets
around it, and GitHub Pages + Actions can therefore only *publish* the data.

Ways to refresh it:

* **Self-hosted runner at home** — set the repo variable `CRAWL_RUNNER` to its
  label, then run the *Crawl* workflow. Actions orchestrates, the data comes
  from your own IP.
* **A small machine or VPS on a non-datacenter IP** — `scripts/vps-crawl.sh`
  with a cron entry. It crawls a budgeted slice, commits, pushes; the *Publish*
  workflow rebuilds the site on every push.
* **From the phone, by asking Buddy** — `node scraper/crawl-cities.mjs
  --budget=300` then commit and push.

Numbeo's own API exists and would remove all of this: 260 USD/month for up to
200k queries. That is the price of not crawling.
