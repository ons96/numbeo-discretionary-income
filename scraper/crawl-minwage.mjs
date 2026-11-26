// Fetches statutory minimum wage per country from a free public API and writes
// data/minwage.json. One request per country (~121), so a few minutes total.
//
//   node scraper/crawl-minwage.mjs
//
// Source: https://api.agentdatahub.de (OECD + ILO), no API key, free for any use
// with credit. Values are in local currency; build.mjs converts to USD via FX.

import { writeFile, readFile, mkdir } from "node:fs/promises";
import { get } from "./lib/http.mjs";

const API = "https://api.agentdatahub.de/api/v1/call/minimum-wage-by-country";

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function main() {
  const cities = await readJson("data/cities.json", { cities: [] });
  const countries = [...new Set((cities.cities || []).map((c) => c.country).filter(Boolean))].sort();

  const records = [];
  for (const country of countries) {
    const url = `${API}?country=${encodeURIComponent(country)}&compact=1`;
    const res = await get(url, { accept: "application/json", retries: 1, timeout: 30000 });
    if (!res.ok) {
      log(`! ${country}: HTTP ${res.status || res.error}`);
      records.push({ country, value: null, currency: null, period: null, source: null, basis: "none", measure: null, error: res.error || `HTTP ${res.status}` });
      continue;
    }
    let j;
    try {
      j = JSON.parse(res.body);
    } catch (e) {
      log(`! ${country}: bad json`);
      records.push({ country, value: null, currency: null, period: null, source: null, basis: "none", measure: null, error: "bad json" });
      continue;
    }
    const d = j?.data || {};
    const unit = d.unit || "";
    // unit like "CAD per hour" / "NGN per month" / "MXN per day"
    const m = unit.match(/^([A-Z]{3})\s+per\s+(hour|day|month)$/i);
    const currency = m ? m[1].toUpperCase() : null;
    const period = m ? m[2].toLowerCase() : null;
    const value = d.latest?.value ?? null;
    // The measure string is the only place the API says *what* the number is:
    // "... statutory minimum wage per hour (OECD)" is a national statutory rate
    // and a bare "(ILO)" is the same thing reported by the other source, but
    // "(regional)", "(sectoral)" and "(national floor)" are aggregates - an
    // average of sub-national or sectoral rates, or a floor that no employer
    // necessarily pays. Switzerland has no federal minimum wage at all, so its
    // ILO regional average (4212 CHF/month) must never be presented as a
    // statutory wage. Keep the measure and classify it here, because merge.mjs
    // cannot recover the qualifier once it is gone.
    const measure = j?.answered_with?.measure ?? null;
    const qualifiers = [...String(measure || "").matchAll(/\(([^)]+)\)/g)].map((x) => x[1].toLowerCase());
    const aggregateQualifier = qualifiers.find((q) => /regional|sectoral|floor|provincial|sub-?national/.test(q));
    const basis = value == null ? "none" : !measure ? "unknown" : aggregateQualifier ? "aggregate" : "national";
    records.push({
      country,
      value,
      currency,
      period,
      effectivePeriod: d.latest?.period ?? null,
      source: j?.source || "OECD/ILO",
      variant: j?.answered_with?.variant ?? null,
      measure,
      basis,
      error: value == null ? "no value" : null,
    });
    log(`  ${country}: ${value} ${unit} (${d.latest?.period})${basis === "national" ? "" : ` [${basis}${aggregateQualifier ? `: ${aggregateQualifier}` : ""}]`}`);
    // be polite
    await new Promise((r) => setTimeout(r, 250));
  }

  await mkdir("data", { recursive: true });
  await writeFile("data/minwage.json", JSON.stringify({ generatedAt: new Date().toISOString(), count: records.length, countries: records }, null, 2));
  const ok = records.filter((r) => r.value != null).length;
  log(`wrote data/minwage.json: ${records.length} countries, ${ok} with a value`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
