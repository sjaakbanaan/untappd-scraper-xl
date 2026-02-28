import { readFileSync } from "fs";
import { CONCURRENCY, OUTPUT_FILE } from "../config.mjs";
import { fetchPage, pool } from "../fetch.mjs";
import { parseBeerDetails } from "../parsers/beers.mjs";
import { parseCheckinStats } from "../parsers/checkin-detail.mjs";
import { writeBeer } from "../db.mjs";
import { saveOutput } from "../storage.mjs";

/**
 * Update-All mode: re-scrape live stats for every entry in the existing output file.
 *
 * Sub-phase A — beer pages → refreshes:
 *   global_rating, global_rating_count, total_checkins, unique_users, monthly_checkins
 *
 * Sub-phase B — individual checkin pages → refreshes:
 *   toasts (count + users), comment_count
 */
export async function phaseUpdateAll() {
  // Load existing output file
  let existing;
  try {
    existing = JSON.parse(readFileSync(OUTPUT_FILE, "utf-8"));
  } catch {
    console.error(`❌  Could not read ${OUTPUT_FILE}. Run a full scrape first.`);
    process.exit(1);
  }

  const allCheckins = existing.checkins;
  console.log(`📂  Loaded ${allCheckins.length} checkins from ${OUTPUT_FILE}\n`);

  // ── Sub-phase A: Beer stats ──────────────────────────────────────────────
  const beerUrls = [...new Set(allCheckins.map((c) => c.beer?.url).filter(Boolean))];
  console.log(`🍺  Update-All A: Re-fetching ${beerUrls.length} beer(s) [${CONCURRENCY} workers]…`);

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
      }
    );
    process.stdout.write("\n");
    console.log(`   ✅ ${done} beers updated, ${errorCount} errors`);
  } catch (err) {
    process.stdout.write("\n");
    throw err;
  }

  // Intermediate save so beer stats are persisted even if checkin phase is interrupted
  saveOutput(allCheckins);

  // ── Sub-phase B: Checkin activity (toasts + comments) ────────────────────
  console.log(`\n💬  Update-All B: Re-fetching ${allCheckins.length} checkin(s) for toasts & comments [${CONCURRENCY} workers]…`);

  try {
    const { done, errorCount } = await pool(
      allCheckins,
      "Checkin",
      allCheckins.length,
      0,
      CONCURRENCY,
      async (c) => {
        const html = await fetchPage(c.checkin_url);
        const stats = parseCheckinStats(html);
        c.toasts = stats.toasts;
        c.comment_count = stats.comment_count;
      }
    );
    process.stdout.write("\n");
    console.log(`   ✅ ${done} checkins updated, ${errorCount} errors`);
  } catch (err) {
    process.stdout.write("\n");
    throw err;
  } finally {
    saveOutput(allCheckins);
  }
}
