# Minimum-wage provenance: reject non-national aggregates

`data/minwage.json` is written by `scraper/crawl-minwage.mjs` from a single free
API (OECD/ILO via api.agentdatahub.de) and is joined onto every city by
`scraper/merge.mjs`, which then converts it to USD and derives a "min wage
leftover". The crawler kept only `value`, `currency`, `period`,
`effectivePeriod`, `source` and `variant`, and threw away the one field that says
what the number actually measures: `answered_with.measure`, whose trailing
qualifier distinguishes a genuine national statutory rate from an aggregate.
Switzerland has no federal minimum wage, yet its ILO *regional* average of
4212.224 CHF/month was applied to Bern, Lausanne, St. Gallen, Zug and Zurich,
producing a fabricated 5067 USD/month minimum wage and a positive "min wage
leftover" (Zurich +1734 USD/month) on a country where the column should be
blank. Iceland's *sectoral* average (Reykjavik +770 USD/month) had the same
defect, as did India's ILO "national floor" and Vietnam's regional average. The
fix persists `measure`, classifies each row as `national` or `aggregate`, and
lets an aggregate row reach a city only when `data/minwage-subnational.json`
supplies a real cantonal, state, provincial or city rate for that place, so the
site never presents an ILO aggregate as the wage an employer owes.

## Acceptance criteria

1. `node scraper/crawl-minwage.mjs` writes `measure` and `basis` for every
   country row. `basis` is `"national"` when the measure carries no scope
   qualifier — both `(OECD)` and a bare `(ILO)` mean a national statutory rate —
   `"aggregate"` when it carries `regional`, `sectoral`, `national floor`,
   `provincial` or `sub-national`, and `"none"` when the API returned no value.
   Verified locally by exit code:

   ```bash
   node -e 'const d=require("./data/minwage.json");
   const g=n=>d.countries.find(r=>r.country===n);
   const want={Switzerland:"aggregate",Iceland:"aggregate",India:"aggregate",
     Vietnam:"aggregate",Germany:"national",Albania:"national",Canada:"national"};
   let bad=0;for(const[n,b]of Object.entries(want)){const got=g(n)?.basis;
     if(got!==b){console.error(n,"want",b,"got",got);bad++}}process.exit(bad?1:0)'
   ```

2. `node scraper/merge.mjs && node scraper/build.mjs` leaves no city carrying a
   country-scope minimum wage from an aggregate row. After a rebuild, the five
   Swiss cities without a cantonal or city rate (Zurich, Bern, Zug, St. Gallen,
   Lausanne) have `minWage === null` in `data/cities.json` and both
   `minWageMonthlyUsd` and `minWageLeftoverMonthly` null in `site/data.json`,
   while Geneva (canton 24.59 CHF), Basel (canton 22.2), Lugano (canton 20.25)
   and Lucerne (city 22.75) keep a value, and Reykjavik is null. Verified by
   `node scraper/check-minwage.mjs` exiting 0 on the good data and exiting 1 with
   five `Switzerland/<city>: wage with no Swiss statutory rate behind it` lines
   when Switzerland's row is forced back to `basis: "national"`.

3. `node scraper/check-minwage.mjs` runs in `.github/workflows/crawl.yml`
   immediately after the Merge step, so a bad upstream response fails the job
   instead of reaching the site. It prints a one-line summary
   (`minwage: N national, M aggregate, K none | cities by scope: ...`) and exits
   1 on any of: a valued row with no measure, a country-scope wage tracing to an
   aggregate row, a Swiss city with a rate that no Swiss statute supports, or a
   `site/data.json` country-scope wage from an aggregate row.
