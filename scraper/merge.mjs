// Merges shard files into data/cities.json (shards win, everything else is kept).
//
//   node scraper/merge.mjs data/shard-0.json data/shard-1.json ...

import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function main() {
  const base = await readJson("data/cities.json", { cities: [] });
  const map = new Map((base.cities || []).map((r) => [r.key, r]));

  let inputs = args;
  if (!inputs.length && existsSync("data")) {
    inputs = (await readdir("data")).filter((f) => /^shard-\d+\.json$/.test(f)).map((f) => `data/${f}`);
  }
  if (!inputs.length) throw new Error("no shard files to merge");

  let updated = 0;
  for (const path of inputs) {
    const shard = await readJson(path, null);
    if (!shard) {
      console.log(`skip ${path} (unreadable)`);
      continue;
    }
    for (const rec of shard.cities || []) {
      const prev = map.get(rec.key);
      if (!prev || Date.parse(rec.scrapedAt || 0) >= Date.parse(prev.scrapedAt || 0)) {
        map.set(rec.key, rec);
        updated++;
      }
    }
    console.log(`${path}: ${(shard.cities || []).length} records`);
  }

  const cities = [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  const withData = cities.filter((c) => c.ok && c.hasData !== false).length;
  await writeFile(
    "data/cities.json",
    JSON.stringify({ generatedAt: new Date().toISOString(), count: cities.length, withData, cities })
  );
  console.log(`data/cities.json: ${cities.length} cities (${withData} with data), ${updated} touched`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
