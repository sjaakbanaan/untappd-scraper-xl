import {
  USER,
  HEADERS,
  DELAY_MS,
  FIRST_BATCH_SIZE,
  BATCH_SIZE,
  BEER_BATCH_SIZE,
  sleep,
} from "./lib/config.mjs";
import { parseCheckins, parseBeerDetails } from "./lib/parsers.mjs";
import {
  loadProgress,
  saveProgress,
  loadBeerCache,
  saveBeerCache,
  saveOutput,
} from "./lib/storage.mjs";

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

async function phase2(allCheckins) {
  console.log(`\n🔎  Phase 2: Fetching beer details…\n`);
  const beerCache = loadBeerCache();

  const urls = [...new Set(allCheckins.map((c) => c.beer?.url).filter(Boolean))].filter(
    (u) => !beerCache[u] || beerCache[u].global_rating === undefined
  );

  console.log(`   ${urls.length} beers to fetch (${Object.keys(beerCache).length - urls.length} fully cached)`);

  let count = 0;
  let errorCount = 0;

  try {
    for (const url of urls) {
      process.stdout.write(`\r🍺  Beer ${++count}/${urls.length}…   `);

      try {
        const html = await fetchPage(url);
        beerCache[url] = parseBeerDetails(html);
      } catch (err) {
        if (++errorCount <= 5) console.warn(`   ⚠️ Failed ${url}: ${err.message}`);
        if (err.message.includes("Session expired")) throw err;
      }

      if (count % BEER_BATCH_SIZE === 0) {
        saveBeerCache(beerCache);
        saveOutput(allCheckins, beerCache);
      }
      await sleep(DELAY_MS);
    }
  } catch (err) {
    process.stdout.write("\n");
    console.error(`\n❌ Phase 2 Error: ${err.message}`);
  } finally {
    if (count > 0) process.stdout.write("\n");
    saveBeerCache(beerCache);
    saveOutput(allCheckins, beerCache);
    if (urls.length > 0) {
      console.log(`\n✅ Beer details: ${Object.keys(beerCache).length} cached, ${errorCount} errors`);
    }
  }
}

async function phase1(progress) {
  console.log(`📋  Phase 1: Scraping checkin feed\n`);

  let allCheckins = progress.checkins;
  const seenIds = new Set(progress.seenIds || allCheckins.map((c) => c.checkin_id));
  let cursor = null;
  let pageNum = 0;
  let emptyPages = 0;
  let done = false;

  // Track how many new checkins have been collected since last flush
  let newSinceLastFlush = 0;
  // First flush threshold is 15 (initial page load), then 25 (each "show more")
  let isFirstFlush = allCheckins.length === 0;
  const nextFlushAt = () => (isFirstFlush ? FIRST_BATCH_SIZE : BATCH_SIZE);

  const flush = async (label) => {
    console.log(`\n💾  ${label} – flushing ${allCheckins.length} checkins to disk…`);
    saveProgress({ checkins: allCheckins, cursor, seenIds: [...seenIds] });
    await phase2(allCheckins);
    isFirstFlush = false;
    newSinceLastFlush = 0;
  };

  try {
    while (!done) {
      pageNum++;
      const url = cursor
        ? `https://untappd.com/profile/more_feed/${USER}/${cursor}?v2=true`
        : `https://untappd.com/user/${USER}`;

      console.log(`📄  Page ${pageNum} ${cursor ? `(cursor: ${cursor})` : "(initial page)"}…`);

      const html = await fetchPage(url);
      const checkins = parseCheckins(html);

      if (checkins.length === 0) {
        if (++emptyPages >= 3) break;
        console.log("⚠️   Empty page, retrying…");
        await sleep(DELAY_MS * 2);
        continue;
      }

      emptyPages = 0;
      let newOnThisPage = 0;

      for (const c of checkins) {
        if (seenIds.has(c.checkin_id)) {
          console.log(`   → Hit existing checkin (ID: ${c.checkin_id}). Stopping incremental update.`);
          done = true;
          break;
        }

        allCheckins.push(c);
        seenIds.add(c.checkin_id);
        newOnThisPage++;
        newSinceLastFlush++;

        // Flush when we've hit the threshold for this batch
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
    // Final flush for any remaining new checkins
    if (newSinceLastFlush > 0) {
      await flush(`Final batch of ${newSinceLastFlush} remaining checkins`);
    } else {
      // Still save progress even if nothing new
      saveProgress({ checkins: allCheckins, cursor, seenIds: [...seenIds] });
    }

    const summary = {
      rated: allCheckins.filter((c) => c.rating !== null).length,
      toasts: allCheckins.reduce((s, c) => s + (c.toasts?.count || 0), 0),
      friends: allCheckins.filter((c) => c.tagged_friends?.length > 0).length,
      badges: allCheckins.reduce((s, c) => s + (c.badges?.length || 0), 0),
    };
    console.log(
      `\n📊 Phase 1 summary: ${allCheckins.length} checkins | ${summary.rated} rated | ${summary.toasts} toasts | ${summary.friends} friends | ${summary.badges} badges`
    );
  }
}

async function main() {
  console.log(`🍺 Untappd Scraper XL — user: "${USER}"\n`);
  const progress = loadProgress();
  await phase1(progress);
}

main();
