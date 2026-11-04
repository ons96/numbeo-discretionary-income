// Tiny persistence helpers shared by the crawlers.
//
// The rule this file exists for: a blocked or empty fetch must never damage
// data we already have. Everything committed under data/ is a cache, and it is
// allowed to be up to STALE_DAYS old before a failure turns the run red - a
// month of numbeo saying "no" leaves the site exactly as it was.

import { readFile, writeFile, mkdir } from "node:fs/promises";

/** Days of cached data we are happy to serve if refreshing fails. */
export const STALE_DAYS = 45;

export async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

/** Ignore the run timestamp when deciding whether anything actually changed. */
const substance = (obj) => {
  if (!obj || typeof obj !== "object") return JSON.stringify(obj);
  const { generatedAt, ...rest } = obj;
  return JSON.stringify(rest);
};

/**
 * Write only when the content differs, so a day without news is not a commit.
 * Returns true when the file was rewritten.
 */
export async function writeIfChanged(path, obj) {
  await mkdir(path.replace(/\/[^/]+$/, ""), { recursive: true });
  const prev = await readJson(path);
  if (prev && substance(prev) === substance(obj)) return false;
  await writeFile(path, JSON.stringify(obj));
  return true;
}

export const ageDays = (iso) =>
  Number.isFinite(Date.parse(iso || "")) ? (Date.now() - Date.parse(iso)) / 86400000 : Infinity;

/** Args like --budget=10 --force -> { budget: "10", force: true }. */
export function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    if (!a.startsWith("--")) continue;
    const [k, v] = a.slice(2).split("=");
    out[k] = v ?? true;
  }
  return out;
}

/**
 * Should this run skip the network? True when the cached copy is younger than
 * maxAgeHours (0 or unset = always fetch).
 */
export async function freshEnough(name, maxAgeHours) {
  if (!(Number(maxAgeHours) > 0)) return false;
  const prev = await readJson(`data/${name}.json`);
  if (!prev?.generatedAt) return false;
  const hours = (Date.now() - Date.parse(prev.generatedAt)) / 3600000;
  if (hours >= Number(maxAgeHours)) return false;
  console.log(`data/${name}.json is ${hours.toFixed(1)} h old, skipping the fetch`);
  return true;
}

/**
 * Called when a fetch failed. Keeps the cached file and only fails the run if
 * that cache is missing or older than STALE_DAYS, so a block is a warning for a
 * while and an alarm only once the numbers really are stale.
 * Returns the process exit code.
 */
export async function failedFetch(name, message) {
  const prev = await readJson(`data/${name}.json`);
  const age = ageDays(prev?.generatedAt);
  if (prev && age < STALE_DAYS) {
    console.log(`::warning::${message} - keeping data/${name}.json from ${age.toFixed(1)} days ago`);
    return 0;
  }
  console.log(`::error::${message} and the cached data/${name}.json is ${Number.isFinite(age) ? `${age.toFixed(0)} days old` : "missing"}`);
  return 1;
}

/** Refuse a parse that is much smaller than what we already have. */
export async function suspiciouslySmall(name, count) {
  const prev = await readJson(`data/${name}.json`);
  const had = prev?.count ?? prev?.cities?.length ?? 0;
  if (had < 50 || count >= had * 0.8) return false;
  console.log(`::warning::only ${count} rows, down from ${had} - treating it as a bad page`);
  return true;
}
