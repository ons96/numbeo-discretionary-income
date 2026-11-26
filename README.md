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

The page opens on **Best option**, which for every city takes whichever of the
four scenarios leaves the most money and names it in its own column - so the
ranking answers "how much could you keep here, living as cheaply as this city
allows" rather than "how much with this exact flat".

The **baseline** box takes any city and keeps only the cities that leave at least
as much money over as it does (in the tab's rent scenario), then lists the
countries that still have a city in that set, with counts. Picking one of those
countries narrows the table to it; the chips stay complete so you can hop
between them.

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
site/                     static page source, no framework
scraper/build.mjs         also writes dist/ with content-hashed css/js (cache-safe deploys)
```

Two workflows:

* **Crawl** (daily, 05:37 UTC) fetches those two pages, merges, and commits
  `data/`.
* **Publish** (on every push) rebuilds and deploys the page.

### Living costs

The bulk table has no "single person living costs" column, so those get crawled
per city. The daily crawl takes **25 new pages a run**, which covers the
remaining cities in about three weeks and then re-checks the oldest ones as they
pass `--max-age-days`. Set the repository variable `PAGE_BUDGET` to change the
drip rate, or to `0` to pause it; `crawl-cities.mjs --budget=0` skips the step.

Every city without a real figure shows **≈** and uses an estimate:
cost-of-living index / 100 × the New York basket, with the anchor taken from the
median of the cities that do have real figures. The estimates get better as
pages arrive.

### Requests, caching, and getting blocked

A refresh is **two requests a day** - that is the whole budget:

| request | what it returns |
| --- | --- |
| `prices_by_city.jsp` | salary + the four rents, all 566 cities |
| `rankings_current.jsp` | cost-of-living / rent / purchasing-power indices |

The per-city page drip (`PAGE_BUDGET`, default 25) and the full country/city
list (`refresh_lists`, off by default) are on top of that, and both are capped so
a run stays polite.

On top of that:

* **20-hour floor.** A run skips the fetch when the cached file is younger than
  20 hours (`--max-age-hours`), so reruns, retries and stray dispatches cost
  nothing. `--force` overrides it.
* **The cache is the source of truth.** `data/*.json` is committed and is what
  the site is built from. A failed fetch never touches it - no truncation, no
  empty table, no "0 cities" deploy.
* **Bad pages are refused.** A table with fewer than 80 % of the rows we already
  have is treated as a failure, not as new data.
* **Blocks are warnings for 45 days.** If numbeo (or the reader) refuses, the run
  logs a warning, keeps the old numbers and stays green. Only when the cache is
  over `STALE_DAYS` (45) does it go red - that is the point at which the site
  really is out of date.
* **Silence is not a commit.** Files are written only when something changed, so
  a quiet day produces no commit and no redeploy.

So a month-long block costs nothing: the page, the CSV and the daily deploy all
keep working off the last good data.

If something does stop, `node scraper/probe.mjs` shows why.

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
* `data/minwage.json` — statutory minimum wage per country from one free
  OECD/ILO API. Each row keeps the API's own `measure` string and a `basis`:
  `national` for a rate the country sets, `aggregate` when the API only offers an
  average of local or sectoral rates, or a "national floor" nobody is obliged to
  pay. Aggregates are never shown as a city's wage.
* `data/minwage-subnational.json` — **hand-maintained.** Minimum wages set below
  the national level, in local currency: US states and the cities with their own
  higher rate, Canadian provinces, Indian states, Chinese provinces, Swiss
  cantons and cities. Each country block states its own `period` (`hour` for
  US/CA/CH, `month` for India and China), `regionScope`, `effective` year and
  `source`/`sourceUrl`. A rate here beats the country rate for matching cities,
  and it is the only way a city in a country with no national minimum
  (Switzerland) or no national figure at all (India, China) gets a value.
  `scraper/check-minwage.mjs` validates the file on every run: missing metadata,
  a `cityRegion` pointing at an undefined region, a non-positive rate, or rates
  more than two years out of date all fail the build.
* `data/pages.json` — per-city Numbeo pages, the source of real (non-estimated)
  living costs. Filled a few dozen cities per crawl by `crawl-cities.mjs`.
* `site/data.json` — compact columnar payload the page loads.
* `site/data.csv` — same data, one row per city, all four scenarios.

`scraper/check-minwage.mjs` is the guard for the wage columns: it runs in the
crawl workflow after the merge and fails the job if any city would show a wage
that came from an aggregate, or a Swiss city a rate no Swiss statute sets.

Records that fail keep `ok: false` with the HTTP status, so a blocked run is
visible in the data rather than silently dropping cities.

---

## The datacenter problem

numbeo.com answers requests from datacenter IP ranges — GitHub's hosted runners
are Azure — with **503 Access Forbidden**, cookies or no cookies, any user agent.
From a normal connection the same URLs return 200. It is an IP-class block, not
a rate limit, so no header tweak fixes it.

Instead of asking for a server, `scraper/lib/http.mjs` tries the direct request
first and, if the answer is 403/429/503, fetches the same URL through
[r.jina.ai](https://r.jina.ai/), a public reader service that returns the page's
original HTML from its own address. The parsers never notice. Two requests a day
is well inside its free tier, and the workflow log prints `fetched via reader`
when that path was used.

If you do have a machine with a residential IP, set the repository variable
`CRAWL_RUNNER` to the label of a self-hosted runner and the requests go out
directly instead; `scripts/vps-crawl.sh` does the same thing from cron without
Actions.

Fallbacks, if the reader ever disappears: run the crawler from a home machine
(`node scraper/crawl-bulk.mjs && node scraper/crawl-indices.mjs`, then commit),
or buy numbeo's own API — 260 USD/month for up to 200k queries.
