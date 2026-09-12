import {
  headersForUntappdUrl,
  CHECKIN_DELAY_MS,
  DELAY_MS,
  sleep,
} from './config.mjs';
import { logError } from './logger.mjs';
import { cDim } from './colors.mjs';

const RATE_LIMIT_MAX_RETRIES = 5;
const RATE_LIMIT_BACKOFF_MS = 10_000;
const RATE_LIMIT_BACKOFF_MAX_MS = 60_000;
const RATE_LIMIT_GAP_MAX_MS = 5_000;

/** Shared across workers so a 429 pauses everyone, not just the one that hit it. */
let cooldownUntil = 0;
/** Extra spacing between requests after a 429; 0 until the first rate limit. */
let requestGapMs = 0;
let lastRequestAt = 0;
let slotTail = Promise.resolve();

/**
 * Fetch a URL with the session cookie headers.
 * Throws a descriptive error on redirect-to-login or non-2xx responses.
 * HTTP 429 is retried with Retry-After / exponential backoff.
 */
export async function fetchPage(url) {
  for (let attempt = 0; ; attempt++) {
    await waitForSlot(url);

    const res = await fetch(url, {
      headers: headersForUntappdUrl(url),
      redirect: 'manual',
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location') || '';
      if (location.includes('/login')) {
        throw new Error(
          '🔒 Session expired – Untappd redirected to login. Grab a fresh cookie.'
        );
      }
    }

    if (res.status === 429 && attempt < RATE_LIMIT_MAX_RETRIES) {
      const alreadyPaused = cooldownUntil > Date.now();
      slowDown();
      const waitMs = rateLimitWaitMs(res.headers.get('retry-after'), attempt);
      extendCooldown(waitMs);
      await drainBody(res);
      if (!alreadyPaused) {
        const secs = Math.max(1, Math.round(waitMs / 1000));
        console.warn(
          `\n   ⏳ HTTP 429 — pausing ${secs}s, then continuing more slowly`
        );
      }
      continue;
    }

    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.text();
  }
}

/**
 * Run `fn(item)` for every item in `items` using at most `concurrency` parallel
 * workers. Each worker sleeps `delayMs` after every request to stay polite.
 * Workers are staggered on start so they don't burst in lockstep.
 *
 * If fn throws with "Session expired", all workers abort immediately.
 */
export async function pool(
  items,
  label,
  total,
  startCount,
  concurrency,
  fn,
  delayMs = DELAY_MS
) {
  let idx = 0;
  let done = 0;
  let errorCount = 0;
  let sessionExpired = false;

  const counter = () => startCount + done;
  const workerCount = Math.min(concurrency, items.length);

  async function worker(workerIndex) {
    if (workerIndex > 0) await sleep((delayMs / workerCount) * workerIndex);
    while (idx < items.length && !sessionExpired) {
      const item = items[idx++]; // grab next item atomically (JS is single-threaded)
      try {
        await fn(item);
      } catch (err) {
        if (err.message.includes('Session expired')) {
          sessionExpired = true;
          throw err;
        }
        errorCount++;
        const where = describePoolItem(item);
        if (errorCount <= 5)
          console.warn(`\n   ⚠️ Failed (${where}): ${err.message}`);
        logError(err.message, where);
      }
      done++;
      process.stdout.write(`\r${cDim(`${label} ${counter()}/${total}.`)}   `);
      await sleep(delayMs);
    }
  }

  const workers = Array.from({ length: workerCount }, (_, i) => worker(i));
  await Promise.all(workers);

  if (sessionExpired)
    throw new Error(
      '🔒 Session expired – Untappd redirected to login. Grab a fresh cookie.'
    );
  return { done, errorCount };
}

function slowDown() {
  requestGapMs = Math.min(
    Math.max(requestGapMs * 2, 2_000),
    RATE_LIMIT_GAP_MAX_MS
  );
}

async function waitForSlot(url) {
  let release;
  const previous = slotTail;
  slotTail = new Promise((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    await respectCooldown();
    const isCheckin = typeof url === 'string' && url.includes('/checkin/');
    const gap = Math.max(requestGapMs, isCheckin ? CHECKIN_DELAY_MS : 0);
    if (gap > 0) {
      const wait = lastRequestAt + gap - Date.now();
      if (wait > 0) await sleep(wait);
    }
    lastRequestAt = Date.now();
  } finally {
    release();
  }
}

async function respectCooldown() {
  const wait = cooldownUntil - Date.now();
  if (wait > 0) await sleep(wait);
}

function extendCooldown(ms) {
  cooldownUntil = Math.max(cooldownUntil, Date.now() + ms);
}

function rateLimitWaitMs(retryAfterHeader, attempt) {
  const fromHeader = parseRetryAfterMs(retryAfterHeader) ?? 0;
  const backoff = Math.min(
    RATE_LIMIT_BACKOFF_MS * 2 ** attempt,
    RATE_LIMIT_BACKOFF_MAX_MS
  );
  const jitter = Math.floor(Math.random() * 400);
  return (
    Math.min(Math.max(fromHeader, backoff), RATE_LIMIT_BACKOFF_MAX_MS) + jitter
  );
}

function parseRetryAfterMs(header) {
  if (!header) return null;
  const value = header.trim();
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value) * 1000;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, timestamp - Date.now());
}

async function drainBody(res) {
  try {
    await res.arrayBuffer();
  } catch {
    // ignore — connection may already be closed
  }
}

function describePoolItem(item) {
  if (typeof item === 'string') return item;
  if (item?.checkin_url) return item.checkin_url;
  if (item?.url) return item.url;
  if (item?.checkin_id != null) return `checkin ${item.checkin_id}`;
  return String(item);
}
