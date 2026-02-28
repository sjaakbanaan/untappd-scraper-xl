import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import {
  OUTPUT_DIR,
  OUTPUT_FILE,
  PROGRESS_FILE,
  USER,
} from "./config.mjs";
import { readBeer, readLocation, readBrewery, readCheckinDetails, hasCheckinDetails } from "./db.mjs";

/**
 * Full scrape: always start from scratch.
 * The db cache (beers/venues/breweries) is still used.
 */
export function loadProgress() {
  console.log(`🆕  Starting full scrape from scratch…`);
  return { checkins: [], cursor: null, seenIds: [] };
}

/**
 * Incremental scrape: resume from last saved progress.
 * Used by the future --incremental flag.
 */
export function loadProgressForResume() {
  if (existsSync(PROGRESS_FILE)) {
    try {
      const data = JSON.parse(readFileSync(PROGRESS_FILE, "utf-8"));
      console.log(`📂  Resuming from previous run – ${data.checkins.length} checkins loaded, cursor: ${data.cursor}`);
      return data;
    } catch {
      console.warn(`⚠️  Progress file corrupted, starting fresh.`);
    }
  }
  return { checkins: [], cursor: null, seenIds: [] };
}

export function saveProgress(state) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(PROGRESS_FILE, JSON.stringify(state));
}

export function saveOutput(checkins) {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const sorted = [...checkins].sort((a, b) => b.checkin_id - a.checkin_id);

  const enriched = sorted.map((c) => {
    // Beer details from db
    const beerDetails = readBeer(c.beer?.url);

    // Venue details from db
    const venueDetails = c.venue?.url ? readLocation(c.venue.url) : null;

    // Purchased at details from db
    const purchasedDetails = c.purchased_at?.url ? readLocation(c.purchased_at.url) : null;

    // Brewery details from db
    const breweryDetails = c.brewery?.url ? readBrewery(c.brewery.url) : null;

    // Flavor profile from db/checkins/ cache
    const checkinDetails = hasCheckinDetails(c.checkin_id)
      ? readCheckinDetails(c.checkin_id)
      : null;

    return {
      ...c,
      beer: beerDetails ? { ...c.beer, ...beerDetails } : c.beer,
      brewery: breweryDetails
        ? { ...c.brewery, ...breweryDetails }
        : c.brewery,
      venue: c.venue && venueDetails ? { ...c.venue, ...venueDetails } : c.venue,
      purchased_at:
        c.purchased_at && purchasedDetails
          ? { ...c.purchased_at, ...purchasedDetails }
          : c.purchased_at,
      flavor: checkinDetails?.flavor ?? c.flavor ?? null,
    };
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
