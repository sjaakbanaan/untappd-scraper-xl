import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { 
  OUTPUT_DIR, 
  OUTPUT_FILE, 
  PROGRESS_FILE, 
  BEER_CACHE_FILE, 
  USER 
} from "./config.mjs";

export function loadBeerCache() {
  if (existsSync(BEER_CACHE_FILE)) {
    try {
      return JSON.parse(readFileSync(BEER_CACHE_FILE, "utf-8"));
    } catch {
      // corrupted, start fresh
    }
  }
  return {};
}

export function saveBeerCache(cache) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(BEER_CACHE_FILE, JSON.stringify(cache));
}

export function loadProgress() {
  if (existsSync(PROGRESS_FILE)) {
    try {
      const data = JSON.parse(readFileSync(PROGRESS_FILE, "utf-8"));
      console.log(`📂  Resuming from previous run – ${data.checkins.length} checkins loaded, cursor: ${data.cursor}`);
      return data;
    } catch {
      // corrupted progress, start fresh
    }
  }
  return { checkins: [], cursor: null, seenIds: [] };
}

export function saveProgress(state) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(PROGRESS_FILE, JSON.stringify(state));
}

export function saveOutput(checkins, beerCache = {}) {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const sorted = [...checkins].sort((a, b) => b.checkin_id - a.checkin_id);

  const enriched = sorted.map((c) => {
    const beerUrl = c.beer?.url;
    const details = beerUrl ? beerCache[beerUrl] : null;
    return details ? { ...c, beer: { ...c.beer, ...details } } : c;
  });

  const output = {
    meta: {
      user: USER,
      total_checkins: enriched.length,
      scraped_at: new Date().toISOString(),
      oldest_checkin: enriched.at(-1)?.created_at || null,
      newest_checkin: enriched.at(0)?.created_at || null,
    },
    checkins: enriched,
  };

  writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`💾  Saved ${enriched.length} checkins → ${OUTPUT_FILE}`);
}
