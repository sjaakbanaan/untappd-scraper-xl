import { CHECKIN_CONCURRENCY, CHECKIN_DELAY_MS } from '../config.mjs';
import { fetchPage, pool } from '../fetch.mjs';
import { parseCheckinFlavors } from '../parsers/checkin-detail.mjs';
import { hasCheckinDetails, writeCheckinDetails } from '../db.mjs';

/**
 * Phase 4: Fetch individual checkin pages to extract flavor profiles.
 * Only runs when --include-flavors is passed.
 */
export async function phase4(allCheckins) {
  const toFetch = allCheckins.filter(
    (c) => c.checkin_id && !hasCheckinDetails(c.checkin_id)
  );

  if (toFetch.length === 0) return;

  console.log(
    `\n🌶️   Phase 4: Fetching flavor profiles for ${toFetch.length} checkin(s) [${CHECKIN_CONCURRENCY} worker(s)]…`
  );

  try {
    const { done, errorCount } = await pool(
      toFetch,
      'Checkin',
      toFetch.length,
      0,
      CHECKIN_CONCURRENCY,
      async (c) => {
        const html = await fetchPage(c.checkin_url);
        const flavor = parseCheckinFlavors(html);
        writeCheckinDetails(c.checkin_id, { flavor });
      },
      CHECKIN_DELAY_MS
    );
    process.stdout.write('\n');
    console.log(`   ✅ ${done} checkins fetched, ${errorCount} errors`);
  } catch (err) {
    process.stdout.write('\n');
    throw err;
  }
}
