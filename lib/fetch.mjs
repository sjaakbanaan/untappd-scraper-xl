import { HEADERS, DELAY_MS, sleep } from "./config.mjs";
import { logError } from "./logger.mjs";

/**
 * Fetch a URL with the session cookie headers.
 * Throws a descriptive error on redirect-to-login or non-2xx responses.
 */
export async function fetchPage(url) {
  const res = await fetch(url, { headers: HEADERS, redirect: "manual" });

  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("location") || "";
    if (location.includes("/login")) {
      throw new Error("🔒 Session expired – Untappd redirected to login. Grab a fresh cookie.");
    }
  }

  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

/**
 * Run `fn(item)` for every item in `items` using at most `concurrency` parallel
 * workers. Each worker sleeps DELAY_MS after every request to stay polite.
 *
 * If fn throws with "Session expired", all workers abort immediately.
 */
export async function pool(items, label, total, startCount, concurrency, fn) {
  let idx = 0;
  let done = 0;
  let errorCount = 0;
  let sessionExpired = false;

  const counter = () => startCount + done;

  async function worker() {
    while (idx < items.length && !sessionExpired) {
      const item = items[idx++]; // grab next item atomically (JS is single-threaded)
      try {
        await fn(item);
      } catch (err) {
        if (err.message.includes("Session expired")) {
          sessionExpired = true;
          throw err;
        }
        errorCount++;
        if (errorCount <= 5) console.warn(`\n   ⚠️ Failed (${item}): ${err.message}`);
        logError(err.message, typeof item === "string" ? item : item?.url ?? String(item));
      }
      done++;
      process.stdout.write(`\r   ${label} ${counter()}/${total}…   `);
      await sleep(DELAY_MS);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);

  if (sessionExpired) throw new Error("🔒 Session expired – Untappd redirected to login. Grab a fresh cookie.");
  return { done, errorCount };
}
