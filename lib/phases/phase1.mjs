import { USER, FIRST_BATCH_SIZE, BATCH_SIZE, DELAY_MS, sleep } from "../config.mjs";
import { fetchPage } from "../fetch.mjs";
import { parseCheckins } from "../parsers/checkins.mjs";
import { saveProgress, saveOutput } from "../storage.mjs";
import { phase2 } from "./phase2.mjs";
import { phase3 } from "./phase3.mjs";
import { phase4 } from "./phase4.mjs";
import { initLog } from "../logger.mjs";
import { cPage, cBatch, cTotal, cSuccess, cPhase } from "../colors.mjs";

/**
 * Phase 1: Scrape the full checkin feed, flushing to disk in batches.
 * Calls phase2/3 (and optionally phase4) after each batch.
 */
export async function phase1(includeFlavors) {
  const startTime = Date.now();
  initLog("Full scrape");
  console.log("");
  console.log(cPhase(`📋 Phase 1: Scraping checkin feed (full run)`));
  console.log("");

  const allCheckins = [];
  const seenIds = new Set();
  let cursor = null;
  let pageNum = 0;
  let emptyPages = 0;

  let newSinceLastFlush = 0;
  let isFirstFlush = true;
  const nextFlushAt = () => (isFirstFlush ? FIRST_BATCH_SIZE : BATCH_SIZE);

  const flush = async (label) => {
    console.log("");
    console.log(cBatch(`💾 ${label} — flushing ${allCheckins.length} checkins...`));
    saveProgress({ checkins: allCheckins, cursor, seenIds: [...seenIds] });
    await phase2(allCheckins);
    await phase3(allCheckins, allCheckins.slice(-newSinceLastFlush));
    if (includeFlavors) await phase4(allCheckins);
    saveOutput(allCheckins);
    isFirstFlush = false;
    newSinceLastFlush = 0;
  };

  try {
    while (true) {
      pageNum++;
      const url = cursor
        ? `https://untappd.com/profile/more_feed/${USER}/${cursor}?v2=true`
        : `https://untappd.com/user/${USER}`;

      console.log(cPage(`📄 Page ${pageNum}...`));

      const html = await fetchPage(url);
      const checkins = parseCheckins(html);

      if (checkins.length === 0) {
        if (++emptyPages >= 3) {
          console.log(`   → Feed exhausted after ${pageNum} pages.`);
          break;
        }
        console.log("⚠️   Empty page, retrying…");
        await sleep(DELAY_MS * 2);
        continue;
      }

      emptyPages = 0;
      let newOnThisPage = 0;

      for (const c of checkins) {
        if (seenIds.has(c.checkin_id)) continue;

        allCheckins.push(c);
        seenIds.add(c.checkin_id);
        newOnThisPage++;
        newSinceLastFlush++;

        if (newSinceLastFlush >= nextFlushAt()) {
          await flush(`Batch of ${newSinceLastFlush} new checkins`);
        }
      }

      console.log(`   → ${checkins.length} on page | ${newOnThisPage} new | ${allCheckins.length} total`);
      const uniqueBeersOnPage = new Set(checkins.map((c) => c.beer?.url).filter(Boolean)).size;
      console.log(`   Summary: ${newOnThisPage} new checkins added (Page ${pageNum}) | Total Checkins: ${uniqueBeersOnPage}`);

      cursor = Math.min(...checkins.map((c) => c.checkin_id));

      await sleep(DELAY_MS);
    }
  } catch (err) {
    if (err.message.includes("Session expired")) throw err;
    console.error(`\n❌ Phase 1 Error: ${err.message}`);
  } finally {
    if (newSinceLastFlush > 0) {
      await flush(`Final batch of ${newSinceLastFlush} remaining checkins`);
    } else if (allCheckins.length === 0) {
      console.log(`\n✅  Phase 1: No new checkins found — phases 2/3/4 skipped.`);
      saveProgress({ checkins: allCheckins, cursor, seenIds: [...seenIds] });
      saveOutput(allCheckins);
    } else {
      saveProgress({ checkins: allCheckins, cursor, seenIds: [...seenIds] });
      saveOutput(allCheckins);
    }

    const totalBeers = new Set(allCheckins.map((c) => c.beer?.url).filter(Boolean)).size;
    const totalVenues = new Set(
      allCheckins.flatMap((c) => [c.venue?.url, c.purchased_at?.url]).filter(Boolean)
    ).size;

    const durationMs = Date.now() - startTime;
    const formatDuration = (ms) => {
      const s = Math.floor(ms / 1000);
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      return [h, m, sec].map((v) => String(v).padStart(2, "0")).join(":");
    };

    console.log("");
    console.log(cTotal(`🏆 Total Checkins: ${allCheckins.length} | Total Beers: ${totalBeers} | Total Venues: ${totalVenues} | Run Time: ${formatDuration(durationMs)}`));
    console.log("");
    console.log(cSuccess(`✅ All Done! Happy untapping! 🚀`));
  }
}
