import "dotenv/config";

export const COOKIE = process.env.UNTAPPD_COOKIE;
export const USER = process.env.UNTAPPD_USER || "sjaakbanaan";
export const DELAY_MS = 1200; // polite delay between requests
export const OUTPUT_DIR = "./output";
export const OUTPUT_FILE = `${OUTPUT_DIR}/${USER}_checkins.json`;
export const PROGRESS_FILE = `${OUTPUT_DIR}/.progress_${USER}.json`;
export const BEER_CACHE_FILE = `${OUTPUT_DIR}/.beer_cache_${USER}.json`;

// First batch saves after 15 checkins (initial page load), then every 25 (each "show more")
export const FIRST_BATCH_SIZE = 15;
export const BATCH_SIZE = 25;

export const BEER_BATCH_SIZE = 50; // save beer cache every N fetches

if (!COOKIE) {
  console.error("❌  Set UNTAPPD_COOKIE in your .env file first.");
  process.exit(1);
}

export const HEADERS = {
  Cookie: COOKIE,
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: `https://untappd.com/user/${USER}`,
  "X-Requested-With": "XMLHttpRequest",
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
