import { existsSync, unlinkSync } from "fs";
import {
  USER,
  HEADERS,
  DELAY_MS,
  FRESH,
  LIMIT,
  PROGRESS_FILE,
  BEER_CACHE_FILE,
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

async function phase1(progress) {
  console.log(`📋  Phase 1: Scraping checkin feed\n`);
  
  let allCheckins = progress.checkins;
  const seenIds = new Set(progress.seenIds || allCheckins.map((c) => c.checkin_id));
  let cursor = progress.cursor;
  let pageNum = cursor ? Math.ceil(allCheckins.length / 25) : 0;
  let emptyPages = 0;

  try {
    while (allCheckins.length < LIMIT) {
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
      let newCount = 0;
      for (const c of checkins) {
        if (!seenIds.has(c.checkin_id)) {
          seenIds.add(c.checkin_id);
          allCheckins.push(c);
          newCount++;
        }
      }

      const stats = {
        rated: checkins.filter(c => c.rating !== null).length,
        toasts: checkins.reduce((s, c) => s + (c.toasts?.count || 0), 0),
        friends: checkins.filter(c => c.tagged_friends?.length > 0).length,
        badges: checkins.reduce((s, c) => s + (c.badges?.length || 0), 0)
      };

      console.log(`   → ${checkins.length} checkins (${newCount} new) | ${stats.rated} rated, ${stats.toasts} toasts, ${stats.friends} friends, ${stats.badges} badges | ${allCheckins.length} total`);

      cursor = Math.min(...checkins.map(c => c.checkin_id));

      if (pageNum % BATCH_SIZE === 0) {
        saveProgress({ checkins: allCheckins, cursor, seenIds: [...seenIds] });
        saveOutput(allCheckins);
      }

      await sleep(DELAY_MS);
    }
  } catch (err) {
    console.error(`\n❌ Phase 1 Error: ${err.message}`);
  } finally {
    saveProgress({ checkins: allCheckins, cursor, seenIds: [...seenIds] });
    saveOutput(allCheckins);
    
    const summary = {
      rated: allCheckins.filter(c => c.rating !== null).length,
      toasts: allCheckins.reduce((s, c) => s + (c.toasts?.count || 0), 0),
      friends: allCheckins.filter(c => c.tagged_friends?.length > 0).length,
      badges: allCheckins.reduce((s, c) => s + (c.badges?.length || 0), 0)
    };
    console.log(`\n📊 Phase 1 summary: ${allCheckins.length} checkins | ${summary.rated} rated | ${summary.toasts} toasts | ${summary.friends} friends | ${summary.badges} badges`);
  }
  return allCheckins;
}

async function phase2(allCheckins) {
  console.log(`\n🔎  Phase 2: Fetching beer details…\n`);
  const beerCache = loadBeerCache();
  const urls = [...new Set(allCheckins.map(c => c.beer?.url).filter(Boolean))].filter(u => !beerCache[u]);
  
  console.log(`   ${urls.length} beers to fetch (${Object.keys(beerCache).length} already cached)`);

  let count = 0;
  let errorCount = 0;

  try {
    for (const url of urls) {
      if (++count % 50 === 0 || count === 1) console.log(`🍺  Fetching beer ${count}/${urls.length}…`);

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
    console.error(`\n❌ Phase 2 Error: ${err.message}`);
  } finally {
    saveBeerCache(beerCache);
    saveOutput(allCheckins, beerCache);
    console.log(`\n✅ Beer details: ${Object.keys(beerCache).length} cached, ${errorCount} errors`);
  }
}

async function main() {
  console.log(`🍺 Untappd Scraper XL — user: "${USER}"\n`);

  if (FRESH) {
    console.log("🧹 --fresh flag: wiping progress and cache…\n");
    [PROGRESS_FILE, BEER_CACHE_FILE].forEach(f => existsSync(f) && unlinkSync(f));
  }

  const allCheckins = await phase1(loadProgress());
  await phase2(allCheckins);
}

main();
