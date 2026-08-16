import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const MAX_BUFFER = 64 * 1024 * 1024;

export function isRateLimited(err) {
  const text = [err?.stderr, err?.message, err?.stdout].filter(Boolean).join(" ");
  return /429|Too Many Requests/i.test(text);
}

export async function curlJson(url, { headers = {}, timeoutMs = 20_000 } = {}) {
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

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class HostBackoff {
  constructor({ baseDelayMs = 1_000, maxDelayMs = 60_000, jitter = 0.3, maxRetries = 4 } = {}) {
    this.baseDelayMs = baseDelayMs;
    this.maxDelayMs = maxDelayMs;
    this.jitter = jitter;
    this.maxRetries = maxRetries;
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

  async waitIfNeeded(host) {
    const wait = this._stateFor(host).retryAfter - Date.now();
    if (wait > 0) await delay(wait);
  }

  note429(host) {
    const state = this._stateFor(host);
    state.failures += 1;
    const backoff = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** (state.failures - 1));
    state.retryAfter = Date.now() + Math.round(backoff * (1 + this.jitter * (Math.random() * 2 - 1)));
  }

  noteSuccess(host) {
    this._state.delete(host);
  }

  async getJson(url, { maxRetries = this.maxRetries, ...curlOpts } = {}) {
    const host = this.hostOf(url);
    for (let attempt = 0; ; attempt++) {
      await this.waitIfNeeded(host);
      try {
        const data = await curlJson(url, curlOpts);
        this.noteSuccess(host);
        return data;
      } catch (err) {
        if (isRateLimited(err) && attempt < maxRetries) {
          this.note429(host);
          continue;
        }
        throw err;
      }
    }
  }
}

export const defaultBackoff = new HostBackoff();
