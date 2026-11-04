// Politeness-first HTTP client: one shared rate limit, bounded concurrency,
// retries with backoff. No dependencies.
//
// numbeo.com serves datacenter IP ranges (GitHub's hosted runners included) a
// "503 Access Forbidden" - not a rate limit, an IP-class block. When a direct
// request comes back blocked, the page is fetched through r.jina.ai instead,
// a reader service that renders public pages from its own address. The body is
// the original HTML, so the parsers do not care where it came from.

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/124.0.0.0 Safari/537.36";

const READER = "https://r.jina.ai/";

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

/** Is this failure the kind that only a different IP can fix? */
const ipBlocked = (res) =>
  res.status === 403 || res.status === 429 || res.status === 503 || res.status === 0;

/** Fetch a public page through r.jina.ai (it returns the raw HTML here). */
async function viaReader(url, timeout) {
  try {
    const res = await limiter.run(() =>
      fetch(READER + url, {
        redirect: "follow",
        signal: AbortSignal.timeout(Math.max(timeout, 90000)),
        headers: {
          "User-Agent": UA,
          "X-Return-Format": "html",
          "X-No-Cache": "true",
        },
      })
    );
    const body = res.ok ? await res.text() : "";
    return { ok: res.ok, status: res.status, url, body, via: "reader" };
  } catch (err) {
    return { ok: false, status: 0, url, body: "", via: "reader", error: String(err) };
  }
}

async function direct(url, { retries, timeout, accept }) {
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
      if (status === 429 || status === 403) {
        const ra = Number(res.headers.get("retry-after"));
        // Numbeo answers a burst with a Retry-After weeks out; retrying then is
        // pointless and only makes the block longer.
        if (Number.isFinite(ra) && ra > 3600) {
          return { ok: false, status, url, body: "", blocked: true, error: `rate limited, retry after ${ra}s` };
        }
        if (res.headers.get("retry-after") && !Number.isFinite(ra)) {
          const when = Date.parse(res.headers.get("retry-after"));
          if (Number.isFinite(when) && when - Date.now() > 3600_000) {
            return { ok: false, status, url, body: "", blocked: true, error: "rate limited (far-future Retry-After)" };
          }
        }
      }
      if (status === 429 || status === 503 || status >= 500) {
        const ra = Number(res.headers.get("retry-after"));
        if (Number.isFinite(ra) && ra > 0) await sleep(Math.min(ra * 1000, 60000));
        lastErr = new Error(`HTTP ${status}`);
        continue;
      }
      const body = res.ok ? await res.text() : "";
      return { ok: res.ok, status, url: res.url || url, body, via: "direct" };
    } catch (err) {
      lastErr = err;
    }
  }
  return { ok: false, status: 0, url, body: "", via: "direct", error: String(lastErr) };
}

/**
 * GET a URL with a browser-ish UA, following redirects, falling back to a
 * reader service when this machine's IP class is refused.
 * Returns { ok, status, url, body } - never throws on HTTP errors.
 */
export async function get(url, opts = {}) {
  const { retries = 3, timeout = 45000, accept = "text/html", reader = true } = opts;
  const res = await direct(url, { retries, timeout, accept });
  if (res.ok || !reader || !ipBlocked(res)) return res;

  const alt = await viaReader(url, timeout);
  if (alt.ok) return alt;
  return { ...alt, error: `${res.error || `HTTP ${res.status}`}, then reader: ${alt.error || `HTTP ${alt.status}`}` };
}
