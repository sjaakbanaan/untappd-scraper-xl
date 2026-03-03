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
    // Beer details from db (null if missing or failed sentinel)
    const beerDetails   = readBeer(c.beer?.url);
    const venueDetails  = c.venue?.url ? readLocation(c.venue.url) : null;
    const purchasedDetails = c.purchased_at?.url ? readLocation(c.purchased_at.url) : null;
    const breweryDetails = c.brewery?.url ? readBrewery(c.brewery.url) : null;

    // Discard failed sentinels — treat them as if nothing was fetched
    const safeBeer     = beerDetails?.failed     ? null : beerDetails;
    const safeVenue    = venueDetails?.failed    ? null : venueDetails;
    const safePurchased = purchasedDetails?.failed ? null : purchasedDetails;
    const safeBrewery  = breweryDetails?.failed  ? null : breweryDetails;

    // Flavor profile from db/checkins/ cache
    const checkinDetails = hasCheckinDetails(c.checkin_id)
      ? readCheckinDetails(c.checkin_id)
      : null;

    // Strip internal db keys from the merged objects (from db cache and from
    // previously-enriched checkins that may have been re-loaded from the output file)
    const { beer_url: _bu, failed: _bf, ...beerData }     = safeBeer     ?? {};
    const { venue_url: _vu, failed: _vf, address: _va, ...venueData }   = safeVenue    ?? {};
    const { brewery_url: _bru, failed: _brf, address: _bra, ...breweryData } = safeBrewery ?? {};
    const { venue_url: _pvu, failed: _pf, address: _pa, ...purchasedData } = safePurchased ?? {};

    // Also strip leaked keys from the base c objects (from a previous run's output)
    const { beer_url: _cbu, ...baseBeer } = c.beer ?? {};
    const { brewery_url: _cbru, address: _cbra, ...baseBrewery } = c.brewery ?? {};
    const { venue_url: _cvu, address: _cva, ...baseVenue } = c.venue ?? {};
    const { venue_url: _cpvu, address: _cpa, ...basePurchased } = c.purchased_at ?? {};

    return {
      ...c,
      beer: safeBeer     ? { ...baseBeer, ...beerData }     : (c.beer         ? baseBeer     : c.beer),
      brewery: safeBrewery  ? { ...baseBrewery, ...breweryData } : (c.brewery     ? baseBrewery  : c.brewery),
      venue: c.venue && safeVenue ? { ...baseVenue, ...venueData }   : (c.venue       ? baseVenue   : c.venue),
      purchased_at:
        c.purchased_at && safePurchased
          ? { ...basePurchased, ...purchasedData }
          : (c.purchased_at ? basePurchased : c.purchased_at),
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
