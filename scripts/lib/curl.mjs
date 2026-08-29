import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const MAX_BUFFER = 64 * 1024 * 1024;

/* Yahoo v10 quoteSummary auth: fc.yahoo.com sets an A3 session cookie, which is
 * exchanged for a crumb via GET /v1/test/getcrumb?crumbs=. The crumb + cookie
 * jar must accompany every quoteSummary request or Yahoo answers 401.
 * The crumb lives as long as the A3 session (~1h); we cache it per process and
 * refresh lazily once the TTL elapses (a fresh fc.yahoo.com + getcrumb round
 * trip). One shared jar file per process (pid-suffixed to avoid cross-process
 * clobbering). */
export const CRUMB_TTL_MS = 50 * 60 * 1000;

let crumbCache = null; /* { crumb, cookieJar, expiresAt } — per-process cache */
let inflightCrumb = null;

export function defaultCrumbJarPath() {
  return join(tmpdir(), `niftyterm-yahoo-crumb-${process.pid}.jar`);
}

/* Test helper: drop the per-process crumb cache. */
export function resetCrumbCache() {
  crumbCache = null;
  inflightCrumb = null;
}

async function runCurl(execImpl, args) {
  try {
    const { stdout } = await execImpl("curl", args, { maxBuffer: MAX_BUFFER, encoding: "utf8" });
    return { stdout };
  } catch (err) {
    const detail = [err?.stderr, err?.message, err?.stdout].filter(Boolean).join(" ").trim();
    throw new Error(`curl ${args[args.length - 1]} failed: ${detail || err?.code || "unknown"}`);
  }
}

const CRUMB_HOSTS = ["query1", "query2"];
export const CRUMB_ATTEMPTS = 4; /* 2 round trips per host */

/* Exchange the A3 cookie for a crumb via v1/test/getcrumb. 429s are paced
 * through the shared HostBackoff (park on sustained throttle) and retried
 * across query1/query2; a throttled failure carries host/rateLimited so the
 * caller can park instead of burning the universe. */
async function fetchCrumbToken(execImpl, jarPath, backoff) {
  let lastErr;
  for (let attempt = 0; attempt < CRUMB_ATTEMPTS; attempt++) {
    const host = CRUMB_HOSTS[attempt % CRUMB_HOSTS.length];
    const hostname = `${host}.finance.yahoo.com`;
    await backoff.waitIfNeeded(hostname);
    try {
      const { stdout } = await runCurl(execImpl, [
        "-sS",
        "-f",
        "--compressed",
        "-m",
        "20",
        "-c",
        jarPath,
        "-b",
        jarPath,
        "-H",
        `User-Agent: ${UA}`,
        "-H",
        "Accept: text/plain, */*",
        `https://${hostname}/v1/test/getcrumb?crumbs=`,
      ]);
      return String(stdout ?? "").trim();
    } catch (err) {
      if (isRateLimited(err)) {
        backoff.note429(hostname);
        lastErr = err;
        lastErr.host = hostname;
        lastErr.rateLimited = true;
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

/* Bootstrap a crumb: 1) GET fc.yahoo.com with the jar to receive the A3 cookie,
 * 2) GET v1/test/getcrumb with the jar to receive the crumb token. Options are
 * injectable for tests (execImpl stubs the curl subprocess; now drives TTL). */
export async function getCrumb({
  execImpl = execFileAsync,
  jarPath = defaultCrumbJarPath(),
  ttlMs = CRUMB_TTL_MS,
  now = Date.now(),
  backoff = crumbBackoff,
  ...explicit
} = {}) {
  const cacheValid = crumbCache && crumbCache.expiresAt > now;
  if (cacheValid) return { crumb: crumbCache.crumb, cookieJar: crumbCache.cookieJar };
  const useShared = Object.keys(explicit).length === 0;
  if (useShared && inflightCrumb) return inflightCrumb;

  const bootstrap = (async () => {
    await runCurl(execImpl, [
      "-sS",
      "--compressed",
      "-m",
      "20",
      "-c",
      jarPath,
      "-H",
      `User-Agent: ${UA}`,
      "-H",
      "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "-H",
      "Accept-Language: en-US,en;q=0.9",
      "https://fc.yahoo.com",
    ]);
    const crumb = await fetchCrumbToken(execImpl, jarPath, backoff);
    if (!/^[A-Za-z0-9_.-]+$/.test(crumb)) {
      throw new Error(`crumb bootstrap: no crumb token from v1/test/getcrumb (got ${JSON.stringify(crumb.slice(0, 40))})`);
    }
    const state = { crumb, cookieJar: jarPath, expiresAt: now + ttlMs };
    crumbCache = state;
    return { crumb, cookieJar: jarPath };
  })();

  if (useShared) {
    inflightCrumb = bootstrap.then(
      (r) => {
        inflightCrumb = null;
        return r;
      },
      (e) => {
        inflightCrumb = null;
        throw e;
      }
    );
    return inflightCrumb;
  }
  return bootstrap;
}

/* Append the crumb + standard quoteSummary params to a v10 URL. */
export function appendCrumb(url, crumb, { lang = "en-US", region = "US" } = {}) {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}crumb=${encodeURIComponent(crumb)}&lang=${encodeURIComponent(lang)}&region=${encodeURIComponent(region)}`;
}

export function isRateLimited(err) {
  const text = [err?.stderr, err?.message, err?.stdout].filter(Boolean).join(" ");
  /* 429 + "Too Many Requests" are explicit throttle signals; curl timeouts
   * (exit 28) on guarded hosts are almost always throttle-induced hangs, so
   * they get the same park-and-pace treatment instead of tripping breakers. */
  return /429|Too Many Requests|timed out|Operation timed out|\(28\)/i.test(text);
}

export async function curlJson(url, { headers = {}, timeoutMs = 20_000, cookieJar } = {}) {
  const args = [
    "-sS",
    "-f",
    "--compressed",
    "-m",
    String(Math.ceil(timeoutMs / 1000)),
    "-H",
    `User-Agent: ${UA}`,
    "-H",
    "Accept: application/json, text/plain, */*",
  ];
  if (cookieJar) args.push("-c", cookieJar, "-b", cookieJar);
  for (const [name, value] of Object.entries(headers)) {
    args.push("-H", `${name}: ${value}`);
  }
  args.push(url);
  const { stdout } = await execFileAsync("curl", args, {
    maxBuffer: MAX_BUFFER,
    encoding: "utf8",
  });
  return JSON.parse(stdout);
}

/** Plain GET that only persists cookies (session bootstrap for Akamai-guarded
 * hosts). Returns the HTTP status; body is discarded. */
export async function curlBootstrap(url, cookieJar, { timeoutMs = 20_000 } = {}) {
  const args = [
    "-sS",
    "--compressed",
    "-m",
    String(Math.ceil(timeoutMs / 1000)),
    "-c",
    cookieJar,
    "-H",
    `User-Agent: ${UA}`,
    "-H",
    "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "-H",
    "Accept-Language: en-US,en;q=0.9",
    url,
  ];
  try {
    await execFileAsync("curl", args, { maxBuffer: MAX_BUFFER, encoding: "utf8" });
    return 0;
  } catch (err) {
    return err?.code ?? 1;
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class HostBackoff {
  constructor({ baseDelayMs = 1_000, maxDelayMs = 60_000, jitter = 0.3, maxRetries = 4, parkMs = 30_000, sustainedThreshold = 2 } = {}) {
    this.baseDelayMs = baseDelayMs;
    this.maxDelayMs = maxDelayMs;
    this.jitter = jitter;
    this.maxRetries = maxRetries;
    /* Sustained throttle: once a host has been hit with `sustainedThreshold`
     * 429s it is parked for a fixed `parkMs` window (instead of the short
     * exponential steps), so a run pauses and lets the window elapse rather
     * than burning the universe with rapid-fire retries. */
    this.parkMs = parkMs;
    this.sustainedThreshold = sustainedThreshold;
    this._state = new Map();
  }

  hostOf(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  _stateFor(host) {
    let state = this._state.get(host);
    if (!state) {
      state = { failures: 0, retryAfter: 0 };
      this._state.set(host, state);
    }
    return state;
  }

  remaining(host) {
    const wait = this._stateFor(host).retryAfter - Date.now();
    return wait > 0 ? wait : 0;
  }

  async waitIfNeeded(host) {
    const wait = this.remaining(host);
    if (wait > 0) await delay(wait);
  }

  note429(host) {
    const state = this._stateFor(host);
    state.failures += 1;
    let backoff;
    if (state.failures >= this.sustainedThreshold) {
      backoff = this.parkMs;
    } else {
      backoff = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** (state.failures - 1));
    }
    state.retryAfter = Date.now() + Math.round(backoff * (1 + this.jitter * (Math.random() * 2 - 1)));
  }

  noteSuccess(host) {
    this._state.delete(host);
  }

  async getJson(url, { maxRetries = this.maxRetries, curlImpl = curlJson, ...curlOpts } = {}) {
    const host = this.hostOf(url);
    for (let attempt = 0; ; attempt++) {
      await this.waitIfNeeded(host);
      try {
        const data = await curlImpl(url, curlOpts);
        this.noteSuccess(host);
        return data;
      } catch (err) {
        if (isRateLimited(err)) {
          this.note429(host);
          if (attempt < maxRetries) continue;
          err.host = host;
          err.rateLimited = true;
          const remaining = this.remaining(host);
          err.retryAfter = remaining > 0 ? Date.now() + remaining : 0;
        }
        throw err;
      }
    }
  }
}

/* Shared per-process backoff for the crumb bootstrap (separate from per-script
 * instances so a throttled crumb exchange parks without blocking other work). */
export const crumbBackoff = new HostBackoff();

export const defaultBackoff = new HostBackoff();
