/**
 * seed-beer-cache.mjs
 *
 * One-off utility: reads the existing checkins output JSON and backfills
 * output/db/beers/<id>.json for every checkin that already has enriched
 * beer data embedded in it. This prevents Phase 2 from re-fetching beers
 * that are already known.
 *
 * Usage: node seed-beer-cache.mjs
 */

import { readFileSync, existsSync } from "fs";
import { OUTPUT_FILE, BEERS_DIR } from "./lib/config.mjs";
import { extractBeerId, hasBeer, writeBeer } from "./lib/db.mjs";

if (!existsSync(OUTPUT_FILE)) {
  console.error(`❌  Output file not found: ${OUTPUT_FILE}`);
  process.exit(1);
}

console.log(`📂  Reading ${OUTPUT_FILE}…`);
const { checkins } = JSON.parse(readFileSync(OUTPUT_FILE, "utf-8"));
console.log(`   → ${checkins.length} checkins loaded\n`);

let seeded = 0;
let skipped = 0;
let noData = 0;

for (const c of checkins) {
  const url = c.beer?.url;
  if (!url) { noData++; continue; }

  // Already cached — nothing to do
  if (hasBeer(url)) { skipped++; continue; }

  // The beer object on the checkin may contain enriched fields from a previous
  // Phase 2 run (style, description, abv, ibu, etc.). Write whatever is there.
  const { beer_url: _drop, ...beerData } = c.beer;

  writeBeer(url, beerData);
  seeded++;

  if (seeded % 500 === 0) {
    process.stdout.write(`\r   ✍️   ${seeded} beers seeded…`);
  }
}

process.stdout.write("\n");
console.log(`\n✅  Done!`);
console.log(`   Seeded : ${seeded}`);
console.log(`   Already cached: ${skipped}`);
console.log(`   No beer URL: ${noData}`);
console.log(`\nYou can now run 'npm run scrape' — Phase 2 will skip these beers.`);
