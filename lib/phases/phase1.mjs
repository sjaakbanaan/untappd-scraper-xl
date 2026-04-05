import { USER, CONCURRENCY, FIRST_BATCH_SIZE, BATCH_SIZE, DELAY_MS, sleep } from "../config.mjs";
import { fetchPage } from "../fetch.mjs";
import { parseCheckins } from "../parsers/checkins.mjs";
import { saveProgress, saveOutput } from "../storage.mjs";
import { phase2 } from "./phase2.mjs";
import { phase3 } from "./phase3.mjs";
import { phase4 } from "./phase4.mjs";
import { initLog } from "../logger.mjs";

/**
 * Phase 1: Scrape the full checkin feed, flushing to disk in batches.
 * Calls phase2/3 (and optionally phase4) after each batch.
 */
export async function phase1(includeFlavors) {
  initLog("Full scrape");
  console.log(`📋  Phase 1: Scraping checkin feed (full run)\n`);

  const allCheckins = [];
  const seenIds = new Set();
  let cursor = null;
  let pageNum = 0;
  let emptyPages = 0;

  let newSinceLastFlush = 0;
  let isFirstFlush = true;
  const nextFlushAt = () => (isFirstFlush ? FIRST_BATCH_SIZE : BATCH_SIZE);

  const flush = async (label) => {
    console.log(`\n💾  ${label} – flushing ${allCheckins.length} checkins…`);
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

      console.log(`📄  Page ${pageNum}…`);

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

    const summary = {
      rated:   allCheckins.filter((c) => c.rating !== null).length,
      toasts:  allCheckins.reduce((s, c) => s + (c.toasts?.count || 0), 0),
      friends: allCheckins.filter((c) => c.tagged_friends?.length > 0).length,
      badges:  allCheckins.reduce((s, c) => s + (c.badges?.length || 0), 0),
    };
    console.log(
      `\n📊 Summary: ${allCheckins.length} checkins | ${summary.rated} rated | ${summary.toasts} toasts | ${summary.friends} friend tags | ${summary.badges} badges`
    );
  }
}
