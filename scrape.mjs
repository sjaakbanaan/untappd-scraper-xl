import {
  USER,
  HEADERS,
  DELAY_MS,
  FIRST_BATCH_SIZE,
  BATCH_SIZE,
  BEER_BATCH_SIZE,
  sleep,
} from "./lib/config.mjs";
import { parseCheckins, parseBeerDetails, parseVenueDetails, parseBreweryDetails } from "./lib/parsers.mjs";
import { loadProgress, saveProgress, saveOutput } from "./lib/storage.mjs";
import {
  hasBeer, writeBeer,
  hasLocation, writeLocation,
  hasBrewery, writeBrewery,
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

// ── Phase 2: Beer details ───────────────────────────────────────────────────

async function phase2(allCheckins) {
  const beerUrls = [...new Set(
    allCheckins.map((c) => c.beer?.url).filter(Boolean)
  )].filter((u) => !hasBeer(u));

  if (beerUrls.length === 0) {
    console.log(`\n🍺  Phase 2: All beers already cached.`);
    return;
  }

  console.log(`\n🍺  Phase 2: Fetching ${beerUrls.length} new beer(s)…`);

  let count = 0;
  let errorCount = 0;

  try {
    for (const url of beerUrls) {
      process.stdout.write(`\r   Beer ${++count}/${beerUrls.length}…   `);
      try {
        const html = await fetchPage(url);
        writeBeer(url, parseBeerDetails(html));
      } catch (err) {
        if (++errorCount <= 5) console.warn(`\n   ⚠️ Failed ${url}: ${err.message}`);
        if (err.message.includes("Session expired")) throw err;
      }

      if (count % BEER_BATCH_SIZE === 0) saveOutput(allCheckins);
      await sleep(DELAY_MS);
    }
  } catch (err) {
    process.stdout.write("\n");
    console.error(`\n❌ Phase 2 Error: ${err.message}`);
  } finally {
    process.stdout.write("\n");
    saveOutput(allCheckins);
    console.log(`   ✅ ${count} beers fetched, ${errorCount} errors`);
  }
}

// ── Phase 3: Venue + Brewery details ────────────────────────────────────────

async function phase3(allCheckins) {
  // Collect all unique venue URLs (venue + purchased_at, both use /v/ pattern)
  const venueUrls = [...new Set(
    allCheckins.flatMap((c) => [c.venue?.url, c.purchased_at?.url]).filter(Boolean)
  )].filter((u) => u.includes("/v/") && !hasLocation(u));

  // Collect unique brewery URLs
  const breweryUrls = [...new Set(
    allCheckins.map((c) => c.brewery?.url).filter(Boolean)
  )].filter((u) => !hasBrewery(u));

  const totalVenues = venueUrls.length;
  const totalBreweries = breweryUrls.length;

  if (totalVenues === 0 && totalBreweries === 0) {
    console.log(`\n📍  Phase 3: All venues & breweries already cached.`);
    return;
  }

  console.log(`\n📍  Phase 3: Fetching ${totalVenues} venue(s) and ${totalBreweries} brewery(ies)…`);

  let count = 0;
  const total = totalVenues + totalBreweries;
  let errorCount = 0;

  const fetchEntity = async (url, label, parseFn, writeFn) => {
    process.stdout.write(`\r   ${label} ${++count}/${total}…   `);
    try {
      const html = await fetchPage(url);
      writeFn(url, parseFn(html));
    } catch (err) {
      if (++errorCount <= 5) console.warn(`\n   ⚠️ Failed ${url}: ${err.message}`);
      if (err.message.includes("Session expired")) throw err;
    }
    await sleep(DELAY_MS);
  };

  try {
    for (const url of venueUrls) {
      await fetchEntity(url, "Location", parseVenueDetails, writeLocation);
    }
    for (const url of breweryUrls) {
      await fetchEntity(url, "Brewery", parseBreweryDetails, writeBrewery);
    }
  } catch (err) {
    process.stdout.write("\n");
    console.error(`\n❌ Phase 3 Error: ${err.message}`);
  } finally {
    process.stdout.write("\n");
    saveOutput(allCheckins);
    console.log(`   ✅ ${count} entities fetched, ${errorCount} errors`);
  }
}

// ── Phase 1: Checkin feed ────────────────────────────────────────────────────

async function phase1(progress) {
  console.log(`📋  Phase 1: Scraping checkin feed\n`);

  let allCheckins = progress.checkins;
  const seenIds = new Set(progress.seenIds || allCheckins.map((c) => c.checkin_id));
  let cursor = null;
  let pageNum = 0;
  let emptyPages = 0;
  let done = false;

  let newSinceLastFlush = 0;
  let isFirstFlush = allCheckins.length === 0;
  const nextFlushAt = () => (isFirstFlush ? FIRST_BATCH_SIZE : BATCH_SIZE);

  const flush = async (label) => {
    console.log(`\n💾  ${label} – flushing ${allCheckins.length} checkins…`);
    saveProgress({ checkins: allCheckins, cursor, seenIds: [...seenIds] });
    await phase2(allCheckins);
    await phase3(allCheckins);
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
    }

    const summary = {
      rated: allCheckins.filter((c) => c.rating !== null).length,
      toasts: allCheckins.reduce((s, c) => s + (c.toasts?.count || 0), 0),
      friends: allCheckins.filter((c) => c.tagged_friends?.length > 0).length,
      badges: allCheckins.reduce((s, c) => s + (c.badges?.length || 0), 0),
    };
    console.log(
      `\n📊 Summary: ${allCheckins.length} checkins | ${summary.rated} rated | ${summary.toasts} toasts | ${summary.friends} friend tags | ${summary.badges} badges`
    );
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`🍺 Untappd Scraper XL — user: "${USER}"\n`);
  const progress = loadProgress();
  await phase1(progress);
}

main();
