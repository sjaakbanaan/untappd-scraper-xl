import { CONCURRENCY, BEER_BATCH_SIZE } from "../config.mjs";
import { fetchPage, pool } from "../fetch.mjs";
import { parseBeerDetails } from "../parsers/beers.mjs";
import { hasBeer, writeBeer } from "../db.mjs";
import { saveOutput } from "../storage.mjs";

/**
 * Phase 2: Fetch beer detail pages for any uncached beer URLs.
 */
export async function phase2(allCheckins) {
  const beerUrls = [...new Set(
    allCheckins.map((c) => c.beer?.url).filter(Boolean)
  )].filter((u) => !hasBeer(u));

  if (beerUrls.length === 0) return;

  console.log(`\n🍺  Phase 2: Fetching ${beerUrls.length} new beer(s) [${CONCURRENCY} workers]…`);
  let saved = 0;

  try {
    const { done, errorCount } = await pool(
      beerUrls,
      "Beer",
      beerUrls.length,
      0,
      CONCURRENCY,
      async (url) => {
        const html = await fetchPage(url);
        writeBeer(url, parseBeerDetails(html));
        if (++saved % BEER_BATCH_SIZE === 0) saveOutput(allCheckins, true);
      }
    );
    process.stdout.write("\n");
    console.log(`   ✅ ${done} beers fetched, ${errorCount} errors`);
  } catch (err) {
    process.stdout.write("\n");
    throw err;
  }
}
