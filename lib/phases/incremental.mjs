import { existsSync, readFileSync } from "fs";
import { USER, OUTPUT_FILE, DELAY_MS, sleep } from "../config.mjs";
import { fetchPage } from "../fetch.mjs";
import { parseCheckins } from "../parsers/checkins.mjs";
import { saveOutput } from "../storage.mjs";
import { phase2 } from "./phase2.mjs";
import { phase3 } from "./phase3.mjs";
import { phase4 } from "./phase4.mjs";
import { initLog } from "../logger.mjs";

/**
 * Incremental scrape: fetch only checkins newer than the existing output file.
 * Stops as soon as a checkin_id that already exists is encountered.
 * Merges new checkins with the existing list and saves the combined output.
 *
 * On first run (no output file) this silently becomes a full scrape.
 */
export async function phaseIncremental(includeFlavors) {
  initLog("Incremental scrape");
  // ── Load existing checkins ───────────────────────────────────────────────
  let existingCheckins = [];
  let knownIds = new Set();

  if (existsSync(OUTPUT_FILE)) {
    try {
      const data = JSON.parse(readFileSync(OUTPUT_FILE, "utf-8"));
      existingCheckins = data.checkins || [];
      knownIds = new Set(existingCheckins.map((c) => c.checkin_id));
      console.log(`📂  Loaded ${existingCheckins.length} existing checkins — scraping for new ones…\n`);
    } catch {
      console.warn(`⚠️   Could not read existing output file, starting fresh.\n`);
    }
  } else {
    console.log(`📋  No existing output found — running full initial scrape…\n`);
  }

  // ── Paginate until a known checkin is hit ────────────────────────────────
  const newCheckins = [];
  const seenThisRun = new Set();
  let cursor = null;
  let pageNum = 0;
  let emptyPages = 0;
  let reachedKnown = false;

  try {
    while (!reachedKnown) {
      pageNum++;
      const url = cursor
        ? `https://untappd.com/profile/more_feed/${USER}/${cursor}?v2=true`
        : `https://untappd.com/user/${USER}`;

      console.log(`📄  Page ${pageNum} ${cursor ? `(cursor: ${cursor})` : "(initial page)"}…`);

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
        if (knownIds.has(c.checkin_id) || seenThisRun.has(c.checkin_id)) {
          reachedKnown = true;
          break;
        }
        newCheckins.push(c);
        seenThisRun.add(c.checkin_id);
        newOnThisPage++;
      }

      console.log(`   → ${checkins.length} on page | ${newOnThisPage} new | ${newCheckins.length} total new`);

      if (!reachedKnown) {
        cursor = Math.min(...checkins.map((c) => c.checkin_id));
        await sleep(DELAY_MS);
      }
    }
  } catch (err) {
    if (err.message.includes("Session expired")) throw err;
    console.error(`\n❌ Incremental scrape error: ${err.message}`);
  }

  // ── Done ─────────────────────────────────────────────────────────────────
  if (newCheckins.length === 0) {
    console.log(`\n✅  Already up to date — no new checkins found.`);
    return;
  }

  console.log(`\n🆕  Found ${newCheckins.length} new checkin(s). Merging with ${existingCheckins.length} existing…`);

  // Merge: new checkins first; saveOutput sorts by checkin_id desc
  const merged = [...newCheckins, ...existingCheckins];

  await phase2(merged);
  await phase3(merged, newCheckins);
  if (includeFlavors) await phase4(merged);
  else saveOutput(merged);

  const summary = {
    rated:   newCheckins.filter((c) => c.rating !== null).length,
    toasts:  newCheckins.reduce((s, c) => s + (c.toasts?.count || 0), 0),
    badges:  newCheckins.reduce((s, c) => s + (c.badges?.length || 0), 0),
  };
  console.log(
    `\n📊 New checkins: ${newCheckins.length} | ${summary.rated} rated | ${summary.toasts} toasts | ${summary.badges} badges`
  );
}
