import {
  USER,
  HEADERS,
  DELAY_MS,
  CONCURRENCY,
  FIRST_BATCH_SIZE,
  BATCH_SIZE,
  BEER_BATCH_SIZE,
  OUTPUT_FILE,
  sleep,
} from "./lib/config.mjs";
import { readFileSync } from "fs";

const INCLUDE_FLAVORS = process.argv.includes("--include-flavors");
const UPDATE_ALL = process.argv.includes("--update-all");

import {
  parseCheckins,
  parseBeerDetails,
  parseVenueDetails,
  parseBreweryDetails,
  parseBreweryVenueUrl,
  parseCheckinFlavors,
  parseCheckinStats,
} from "./lib/parsers.mjs";
import { saveProgress, saveOutput } from "./lib/storage.mjs";
import {
  hasBeer, writeBeer,
  hasLocation, writeLocation, readLocation,
  hasBrewery, writeBrewery,
  hasCheckinDetails, writeCheckinDetails,
} from "./lib/db.mjs";

async function fetchPage(url) {
  const res = await fetch(url, { headers: HEADERS, redirect: "manual" });

  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("location") || "";
    if (location.includes("/login")) {
      throw new Error("🔒 Session expired – Untappd redirected to login. Grab a fresh cookie.");
    }
  }

  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

/**
 * Run `fn(item)` for every item in `items` using at most `concurrency` parallel
 * workers. Each worker awaits a DELAY_MS sleep after every successful or failed
 * request so we stay polite while still getting N× throughput.
 *
 * If fn throws with "Session expired", all workers abort immediately.
 */
async function pool(items, label, total, startCount, concurrency, fn) {
  let idx = 0;
  let done = 0;
  let errorCount = 0;
  let sessionExpired = false;

  const counter = () => startCount + done;

  async function worker() {
    while (idx < items.length && !sessionExpired) {
      const item = items[idx++]; // grab next item atomically (JS is single-threaded)
      try {
        await fn(item);
      } catch (err) {
        if (err.message.includes("Session expired")) {
          sessionExpired = true;
          throw err;
        }
        if (++errorCount <= 5) console.warn(`\n   ⚠️ Failed: ${err.message}`);
      }
      done++;
      process.stdout.write(`\r   ${label} ${counter()}/${total}…   `);
      await sleep(DELAY_MS);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);

  if (sessionExpired) throw new Error("🔒 Session expired – Untappd redirected to login. Grab a fresh cookie.");
  return { done, errorCount };
}

// ── Phase 2: Beer details ───────────────────────────────────────────────────

async function phase2(allCheckins) {
  const beerUrls = [...new Set(
    allCheckins.map((c) => c.beer?.url).filter(Boolean)
  )].filter((u) => !hasBeer(u));

  if (beerUrls.length === 0) {
    console.log(`\n🍺  Phase 2: All beers already cached.`);
    return;
  }

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
        if (++saved % BEER_BATCH_SIZE === 0) saveOutput(allCheckins);
      }
    );
    process.stdout.write("\n");
    console.log(`   ✅ ${done} beers fetched, ${errorCount} errors`);
  } catch (err) {
    process.stdout.write("\n");
    throw err;
  } finally {
    saveOutput(allCheckins);
  }
}

// ── Phase 3: Venue + Brewery details ────────────────────────────────────────

async function phase3(allCheckins) {
  const venueUrls = [...new Set(
    allCheckins.flatMap((c) => [c.venue?.url, c.purchased_at?.url]).filter(Boolean)
  )].filter((u) => u.includes("/v/") && !hasLocation(u));

  const breweryUrls = [...new Set(
    allCheckins.map((c) => c.brewery?.url).filter(Boolean)
  )].filter((u) => !hasBrewery(u));

  const totalVenues    = venueUrls.length;
  const totalBreweries = breweryUrls.length;
  const total          = totalVenues + totalBreweries;

  if (total === 0) {
    console.log(`\n📍  Phase 3: All venues & breweries already cached.`);
    return;
  }

  console.log(`\n📍  Phase 3: Fetching ${totalVenues} venue(s) and ${totalBreweries} brewery(ies) [${CONCURRENCY} workers]…`);

  try {
    // --- Venues ---
    if (venueUrls.length > 0) {
      const { done: vd, errorCount: ve } = await pool(
        venueUrls, "Location", total, 0, CONCURRENCY,
        async (url) => {
          const html = await fetchPage(url);
          writeLocation(url, parseVenueDetails(html));
        }
      );
      process.stdout.write("\n");
      console.log(`   ✅ ${vd} venues fetched, ${ve} errors`);
    }

    // --- Breweries (with venue sub-fetch for lat/lng) ---
    if (breweryUrls.length > 0) {
      const { done: bd, errorCount: be } = await pool(
        breweryUrls, "Brewery", total, totalVenues, CONCURRENCY,
        async (url) => {
          const html = await fetchPage(url);
          const breweryData = parseBreweryDetails(html);

          if (breweryData.lat === null) {
            const venueUrl = parseBreweryVenueUrl(html);
            if (venueUrl) {
              let venueDetails = readLocation(venueUrl);
              if (!venueDetails) {
                try {
                  await sleep(DELAY_MS);
                  const venueHtml = await fetchPage(venueUrl);
                  venueDetails = parseVenueDetails(venueHtml);
                  writeLocation(venueUrl, venueDetails);
                } catch (e) {
                  console.warn(`\n   ⚠️ Failed brewery venue ${venueUrl}: ${e.message}`);
                }
              }
              if (venueDetails?.lat !== null) {
                breweryData.lat = venueDetails.lat;
                breweryData.lng = venueDetails.lng;
              }
            }
          }

          writeBrewery(url, breweryData);
        }
      );
      process.stdout.write("\n");
      console.log(`   ✅ ${bd} breweries fetched, ${be} errors`);
    }
  } catch (err) {
    process.stdout.write("\n");
    throw err;
  } finally {
    saveOutput(allCheckins);
  }
}

// ── Phase 4: Flavor profiles ─────────────────────────────────────────────────

async function phase4(allCheckins) {
  const toFetch = allCheckins.filter(
    (c) => c.checkin_id && !hasCheckinDetails(c.checkin_id)
  );

  if (toFetch.length === 0) {
    console.log(`\n🌶️   Phase 4: All flavor profiles already cached.`);
    return;
  }

  console.log(`\n🌶️   Phase 4: Fetching flavor profiles for ${toFetch.length} checkin(s) [${CONCURRENCY} workers]…`);

  try {
    const { done, errorCount } = await pool(
      toFetch,
      "Checkin",
      toFetch.length,
      0,
      CONCURRENCY,
      async (c) => {
        const html = await fetchPage(c.checkin_url);
        const flavor = parseCheckinFlavors(html);
        writeCheckinDetails(c.checkin_id, { flavor });
      }
    );
    process.stdout.write("\n");
    console.log(`   ✅ ${done} checkins fetched, ${errorCount} errors`);
  } catch (err) {
    process.stdout.write("\n");
    throw err;
  } finally {
    saveOutput(allCheckins);
  }
}

// ── Phase 1: Checkin feed ────────────────────────────────────────────────────

async function phase1() {
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
    await phase3(allCheckins);
    if (INCLUDE_FLAVORS) await phase4(allCheckins);
    else saveOutput(allCheckins); // phase2/3 already call saveOutput, but guard for skipped phase4
    isFirstFlush = false;
    newSinceLastFlush = 0;
  };

  try {
    while (true) {
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

// ── Phase Update-All ─────────────────────────────────────────────────────────

async function phaseUpdateAll() {
  // Load existing output file
  let existing;
  try {
    existing = JSON.parse(readFileSync(OUTPUT_FILE, "utf-8"));
  } catch {
    console.error(`❌  Could not read ${OUTPUT_FILE}. Run a full scrape first.`);
    process.exit(1);
  }

  // Work on a mutable copy of the checkins array (objects are refs so patches apply in place)
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

  // Intermediate save so beer stats are in the output even if checkin phase is interrupted
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

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (UPDATE_ALL) {
    console.log(`🔄 Untappd Scraper XL — user: "${USER}" [--update-all, concurrency: ${CONCURRENCY}]\n`);
    await phaseUpdateAll();
    return;
  }

  const flags = INCLUDE_FLAVORS ? " +flavors" : "";
  console.log(`🍺 Untappd Scraper XL — user: "${USER}" [concurrency: ${CONCURRENCY}${flags}]\n`);
  if (!INCLUDE_FLAVORS) {
    console.log(`ℹ️   Phase 4 (flavor profiles) skipped. Run with --include-flavors to enable it.\n`);
  }
  await phase1();
}

main();
