// Politeness-first HTTP client: one shared rate limit, bounded concurrency,
// retries with backoff. No dependencies.

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/124.0.0.0 Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Limiter {
  constructor({ concurrency = 2, minGapMs = 900 } = {}) {
    this.concurrency = concurrency;
    this.minGapMs = minGapMs;
    this.active = 0;
    this.lastStart = 0;
    this.queue = [];
  }

  async run(fn) {
    if (this.active >= this.concurrency) {
      await new Promise((resolve) => this.queue.push(resolve));
    }
    this.active++;
    try {
      const wait = this.lastStart + this.minGapMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastStart = Date.now();
      return await fn();
    } finally {
      this.active--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

export const limiter = new Limiter({
  concurrency: Number(process.env.CONCURRENCY || 2),
  minGapMs: Number(process.env.MIN_GAP_MS || 900),
});

/**
 * GET a URL with a browser-ish UA, following redirects.
 * Returns { ok, status, url, body } — never throws on HTTP errors.
 */
export async function get(url, { retries = 3, timeout = 45000, accept = "text/html" } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(Math.min(2000 * 2 ** (attempt - 1), 20000));
    try {
      const res = await limiter.run(() =>
        fetch(url, {
          redirect: "follow",
          signal: AbortSignal.timeout(timeout),
          headers: {
            "User-Agent": UA,
            Accept: accept + ",*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
          },
        })
      );
      const status = res.status;
      if (status === 429 || status === 503 || status >= 500) {
        const ra = Number(res.headers.get("retry-after"));
        if (Number.isFinite(ra) && ra > 0) await sleep(Math.min(ra * 1000, 60000));
        lastErr = new Error(`HTTP ${status}`);
        continue;
      }
      const body = res.ok ? await res.text() : "";
      return { ok: res.ok, status, url: res.url || url, body };
    } catch (err) {
      lastErr = err;
    }
  }
  return { ok: false, status: 0, url, body: "", error: String(lastErr) };
}
