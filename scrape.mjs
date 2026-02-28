import "dotenv/config";
import * as cheerio from "cheerio";
import { writeFileSync, mkdirSync, existsSync, readFileSync, unlinkSync } from "fs";

// ─── Config ────────────────────────────────────────────────────────────────────
const COOKIE = process.env.UNTAPPD_COOKIE;
const USER = process.env.UNTAPPD_USER || "sjaakbanaan";
const DELAY_MS = 1200; // polite delay between requests
const OUTPUT_DIR = "./output";
const OUTPUT_FILE = `${OUTPUT_DIR}/${USER}_checkins.json`;
const PROGRESS_FILE = `${OUTPUT_DIR}/.progress_${USER}.json`;
const BEER_CACHE_FILE = `${OUTPUT_DIR}/.beer_cache_${USER}.json`;
const BATCH_SIZE = 25; // save to disk every N pages
const BEER_BATCH_SIZE = 50; // save beer cache every N fetches
const FRESH = process.argv.includes("--fresh");
const limitArgIndex = process.argv.indexOf("--limit");
const LIMIT = limitArgIndex !== -1 ? Number(process.argv[limitArgIndex + 1]) : Infinity;

if (!COOKIE || COOKIE === "your_cookie_string_here") {
  console.error("❌  Set UNTAPPD_COOKIE in your .env file first.");
  console.error("   See .env.example for instructions.");
  process.exit(1);
}

// Wipe progress if --fresh flag is used
if (FRESH) {
  console.log("🧹  --fresh flag detected, wiping progress and cache…\n");
  [PROGRESS_FILE, BEER_CACHE_FILE].forEach((f) => {
    if (existsSync(f)) { unlinkSync(f); console.log(`   Deleted ${f}`); }
  });
  console.log();
}

// ─── HTTP helpers ──────────────────────────────────────────────────────────────
const HEADERS = {
  Cookie: COOKIE,
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: `https://untappd.com/user/${USER}`,
  "X-Requested-With": "XMLHttpRequest",
};

async function fetchPage(url) {
  const res = await fetch(url, { headers: HEADERS, redirect: "manual" });

  // Detect login redirect (session expired)
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("location") || "";
    if (location.includes("/login")) {
      throw new Error(
        "🔒  Session expired – Untappd redirected to login.\n" +
          "   Grab a fresh cookie from your browser and update .env"
      );
    }
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }

  return res.text();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── HTML parsing ──────────────────────────────────────────────────────────────
function parseCheckins(html) {
  const $ = cheerio.load(html);
  const checkins = [];

  $(".item[data-checkin-id]").each((_, el) => {
    const $el = $(el);
    const checkinId = Number($el.attr("data-checkin-id"));

    // Text block: "User is drinking a Beer by Brewery at Venue"
    const $text = $el.find(".checkin .top p.text, .checkin .top .text");

    // Beer
    const $beerLink = $text.find('a[href*="/b/"]');
    const beerName = $beerLink.text().trim();
    const beerUrl = $beerLink.attr("href")
      ? `https://untappd.com${$beerLink.attr("href")}`
      : null;

    // Brewery
    const $breweryLink = $text
      .find("a")
      .filter((_, a) => {
        const href = $(a).attr("href") || "";
        return (
          !href.includes("/b/") &&
          !href.includes("/v/") &&
          !href.includes("/user/") &&
          href !== "#"
        );
      })
      .first();
    const breweryName = $breweryLink.text().trim();
    const breweryUrl = $breweryLink.attr("href")
      ? `https://untappd.com${$breweryLink.attr("href")}`
      : null;

    // Venue (drinking at) — from the main text line
    const $venueLink = $text.find('a[href*="/v/"]').first();
    const venueName = $venueLink.text().trim() || null;
    const venueUrl = $venueLink.attr("href")
      ? `https://untappd.com${$venueLink.attr("href")}`
      : null;

    // Purchased at — from p.purchased inside .checkin-comment
    const $purchased = $el.find(".checkin-comment p.purchased a").first();
    const purchasedAt = $purchased.length
      ? {
          name: $purchased.text().trim(),
          url: `https://untappd.com${$purchased.attr("href")}`,
        }
      : null;

    // Rating
    const $caps = $el.find(".caps[data-rating]");
    const rating = $caps.length ? Number($caps.attr("data-rating")) : null;

    // Serving type — from p.serving > span
    const $serving = $el.find("p.serving span");
    const servingType = $serving.length ? $serving.text().trim() : null;

    // User comment — the checkin-comment div text, excluding structured elements
    const $commentBlock = $el.find(".checkin-comment").clone();
    // Remove nested structured elements so we only get the user's own text
    $commentBlock.find("p.purchased, .rating-serving, .tagged-friends, .badge, span.badge").remove();
    const commentText = $commentBlock.text().trim().replace(/\s+/g, " ");
    const comment = commentText || null;

    // Timestamp
    const $time = $el.find("a.time, a.timezoner, .time.timezoner").first();
    const dateStr = $time.text().trim();
    let createdAt = null;
    if (dateStr) {
      try {
        const d = new Date(dateStr);
        createdAt = isNaN(d.getTime()) ? dateStr : d.toISOString();
      } catch {
        createdAt = dateStr;
      }
    }

    // Photo
    const $photo = $el.find(".photo img, .checkin-media img");
    const photoUrl = $photo.attr("data-original") || $photo.attr("src") || null;

    // Beer label image
    const $label = $el.find(".top .label img, .top a.label img");
    const labelUrl = $label.attr("data-original") || $label.attr("src") || null;

    // ─── Toasts ──────────────────────────────────────────────────────────
    const $cheers = $el.find(".cheers");
    const toastCount = Number($cheers.find(".count span").text().trim()) || 0;
    const toastUsers = [];
    $cheers.find("a.user-toasts").each((_, a) => {
      const username = $(a).attr("data-user-name");
      if (username) toastUsers.push(username);
    });

    // ─── Comments (from the comments container) ──────────────────────────
    const $comments = $el.find(".comments .comments-container");
    // Comments are lazily loaded, so we count what's in the DOM
    const commentCount = $comments.find(".comment").length;

    // ─── Tagged friends ──────────────────────────────────────────────────
    const taggedFriends = [];
    $el.find(".tagged-friends a[href*='/user/']").each((_, a) => {
      const href = $(a).attr("href") || "";
      const username = href.split("/user/")[1]?.replace(/\/$/, "");
      if (username) taggedFriends.push(username);
    });

    // ─── Badges earned ──────────────────────────────────────────────────
    const badges = [];
    $el.find("span.badge").each((_, badge) => {
      const $badge = $(badge);
      const badgeText = $badge.find("span").text().trim();
      const $badgeImg = $badge.find("img");
      const badgeImageUrl = $badgeImg.attr("src") || null;
      const badgeName = $badgeImg.attr("alt") || badgeText.replace(/^Earned the\s+/, "").replace(/\s+badge!$/, "");

      if (badgeText || badgeName) {
        badges.push({
          name: badgeName,
          text: badgeText,
          image_url: badgeImageUrl,
        });
      }
    });

    // Checkin URL
    const checkinUrl = `https://untappd.com/user/${USER}/checkin/${checkinId}`;

    checkins.push({
      checkin_id: checkinId,
      checkin_url: checkinUrl,
      created_at: createdAt,
      beer: {
        name: beerName || null,
        url: beerUrl,
        label_url: labelUrl,
      },
      brewery: {
        name: breweryName || null,
        url: breweryUrl,
      },
      venue: venueName
        ? {
            name: venueName,
            url: venueUrl,
          }
        : null,
      purchased_at: purchasedAt,
      rating,
      serving_type: servingType,
      comment,
      photo_url: photoUrl,
      toasts: {
        count: toastCount,
        users: toastUsers,
      },
      comment_count: commentCount,
      tagged_friends: taggedFriends,
      badges,
    });
  });

  return checkins;
}

// ─── Beer detail parsing ───────────────────────────────────────────────────────
function parseBeerDetails(html) {
  const $ = cheerio.load(html);
  const $content = $(".content");

  // Global rating
  const $globalCaps = $content.find(".details .caps[data-rating]");
  const globalRating = $globalCaps.length
    ? Number($globalCaps.attr("data-rating"))
    : null;

  // ABV
  const abvText = $content.find("p.abv").text().trim();
  const abvMatch = abvText.match(/([\d.]+)\s*%/);
  const abv = abvMatch ? Number(abvMatch[1]) : null;

  // IBU
  const ibuText = $content.find("p.ibu").text().trim();
  const ibuMatch = ibuText.match(/(\d+)\s*IBU/);
  const ibu = ibuMatch ? Number(ibuMatch[1]) : null;

  // Style
  const style = $content.find("p.style").text().trim() || null;

  // Description
  const description =
    $content.find(".beer-descrption-read-more").text().trim() || null;

  // Total ratings count
  const ratersText = $content.find("p.raters").text().trim();
  const ratersMatch = ratersText.match(/([\d,]+)\s*Rating/i);
  const totalRatings = ratersMatch
    ? Number(ratersMatch[1].replace(/,/g, ""))
    : null;

  // Stats: total checkins, unique, monthly
  const stats = {};
  $content.find(".stats p").each((_, p) => {
    const label = $(p).find(".stat").text().trim().replace(/\s*\(.*\)/, "").toLowerCase();
    const value = $(p).find(".count").text().trim().replace(/,/g, "");
    if (label && value && !label.includes("you")) {
      stats[label] = Number(value) || 0;
    }
  });

  return {
    global_rating: globalRating,
    global_rating_count: totalRatings,
    abv,
    ibu,
    style,
    description,
    total_checkins: stats.total || null,
    unique_users: stats.unique || null,
    monthly_checkins: stats.monthly || null,
  };
}

// ─── Beer cache ────────────────────────────────────────────────────────────────
function loadBeerCache() {
  if (existsSync(BEER_CACHE_FILE)) {
    try {
      return JSON.parse(readFileSync(BEER_CACHE_FILE, "utf-8"));
    } catch {
      // corrupted, start fresh
    }
  }
  return {};
}

function saveBeerCache(cache) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(BEER_CACHE_FILE, JSON.stringify(cache));
}

// ─── Progress / resume support ─────────────────────────────────────────────────
function loadProgress() {
  if (existsSync(PROGRESS_FILE)) {
    try {
      const data = JSON.parse(readFileSync(PROGRESS_FILE, "utf-8"));
      console.log(
        `📂  Resuming from previous run – ${data.checkins.length} checkins loaded, cursor: ${data.cursor}`
      );
      return data;
    } catch {
      // corrupted progress, start fresh
    }
  }
  return { checkins: [], cursor: null, seenIds: [] };
}

function saveProgress(state) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(PROGRESS_FILE, JSON.stringify(state));
}

function saveOutput(checkins, beerCache = {}) {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  // Sort by checkin_id descending (newest first)
  const sorted = [...checkins].sort((a, b) => b.checkin_id - a.checkin_id);

  // Enrich checkins with beer details from cache
  const enriched = sorted.map((c) => {
    const beerUrl = c.beer?.url;
    const details = beerUrl ? beerCache[beerUrl] : null;
    if (details) {
      return {
        ...c,
        beer: {
          ...c.beer,
          ...details,
        },
      };
    }
    return c;
  });

  const output = {
    meta: {
      user: USER,
      total_checkins: enriched.length,
      scraped_at: new Date().toISOString(),
      oldest_checkin: enriched.at(-1)?.created_at || null,
      newest_checkin: enriched.at(0)?.created_at || null,
    },
    checkins: enriched,
  };

  writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`💾  Saved ${enriched.length} checkins → ${OUTPUT_FILE}`);
}

// ─── Main scraper loop ─────────────────────────────────────────────────────────
async function main() {
  console.log(`🍺  Untappd Scraper XL — scraping checkins for "${USER}"\n`);
  console.log(`📋  Phase 1: Scraping checkin feed\n`);

  const progress = loadProgress();
  let allCheckins = progress.checkins;
  const seenIds = new Set(progress.seenIds || allCheckins.map((c) => c.checkin_id));
  let cursor = progress.cursor;
  let pageNum = cursor ? Math.ceil(allCheckins.length / 25) : 0;
  let emptyPages = 0;

  try {
    while (true) {
      pageNum++;

      const url = cursor
        ? `https://untappd.com/profile/more_feed/${USER}/${cursor}?v2=true`
        : `https://untappd.com/user/${USER}`;

      console.log(
        `📄  Page ${pageNum} ${cursor ? `(cursor: ${cursor})` : "(initial page)"}…`
      );

      const html = await fetchPage(url);
      const checkins = parseCheckins(html);

      if (checkins.length === 0) {
        emptyPages++;
        if (emptyPages >= 3) {
          console.log("✅  No more checkins found – done!");
          break;
        }
        console.log("⚠️   Empty page, retrying…");
        await sleep(DELAY_MS * 2);
        continue;
      }

      emptyPages = 0;

      // Dedupe
      let newCount = 0;
      for (const c of checkins) {
        if (!seenIds.has(c.checkin_id)) {
          seenIds.add(c.checkin_id);
          allCheckins.push(c);
          newCount++;
        }
      }

      // Per-page stats
      const pageToasts = checkins.reduce((s, c) => s + (c.toasts?.count || 0), 0);
      const pageTagged = checkins.filter((c) => c.tagged_friends?.length > 0).length;
      const pageBadges = checkins.reduce((s, c) => s + (c.badges?.length || 0), 0);
      const pageRated = checkins.filter((c) => c.rating !== null).length;

      console.log(
        `   → ${checkins.length} checkins (${newCount} new) | ` +
          `${pageRated} rated, ${pageToasts} toasts, ${pageTagged} w/ tagged friends, ${pageBadges} badges | ` +
          `${allCheckins.length} total`
      );

      // Update cursor to the smallest (oldest) checkin ID in this batch
      const ids = checkins.map((c) => c.checkin_id);
      cursor = Math.min(...ids);

      // Periodic save
      if (pageNum % BATCH_SIZE === 0) {
        saveProgress({
          checkins: allCheckins,
          cursor,
          seenIds: [...seenIds],
        });
        saveOutput(allCheckins);
      }

      // Check limit
      if (allCheckins.length >= LIMIT) {
        console.log(`\n🛑  Reached limit of ${LIMIT} checkins – moving to summary.`);
        break;
      }

      await sleep(DELAY_MS);
    }
  } catch (err) {
    console.error(`\n❌  Error: ${err.message}`);
    console.log("💾  Saving progress so you can resume later…");
  } finally {
    // Always save what we have
    saveProgress({
      checkins: allCheckins,
      cursor,
      seenIds: [...seenIds],
    });
    saveOutput(allCheckins);

    // Phase 1 summary
    const totalToasts = allCheckins.reduce((s, c) => s + (c.toasts?.count || 0), 0);
    const totalTagged = allCheckins.filter((c) => c.tagged_friends?.length > 0).length;
    const totalBadges = allCheckins.reduce((s, c) => s + (c.badges?.length || 0), 0);
    const totalRated = allCheckins.filter((c) => c.rating !== null).length;
    console.log(`\n📊  Phase 1 summary:`);
    console.log(`   ${allCheckins.length} checkins | ${totalRated} rated | ${totalToasts} toasts | ${totalTagged} w/ tagged friends | ${totalBadges} badges`);
  }

  // ─── Phase 2: Fetch beer details ───────────────────────────────────────
  console.log(`\n🔎  Phase 2: Fetching beer details…\n`);

  const beerCache = loadBeerCache();
  const uniqueBeerUrls = [
    ...new Set(allCheckins.map((c) => c.beer?.url).filter(Boolean)),
  ];
  const uncachedUrls = uniqueBeerUrls.filter((url) => !beerCache[url]);

  console.log(
    `   ${uniqueBeerUrls.length} unique beers, ${uniqueBeerUrls.length - uncachedUrls.length} already cached, ${uncachedUrls.length} to fetch`
  );

  let fetchedCount = 0;
  let errorCount = 0;

  try {
    for (const beerUrl of uncachedUrls) {
      fetchedCount++;

      if (fetchedCount % 100 === 0 || fetchedCount === 1) {
        console.log(
          `🍺  Fetching beer ${fetchedCount}/${uncachedUrls.length}…`
        );
      }

      try {
        const html = await fetchPage(beerUrl);
        const details = parseBeerDetails(html);
        beerCache[beerUrl] = details;
      } catch (err) {
        errorCount++;
        if (err.message.includes("Session expired")) throw err;
        // Log but continue on individual beer errors
        if (errorCount <= 5) {
          console.warn(`   ⚠️  Failed ${beerUrl}: ${err.message}`);
        } else if (errorCount === 6) {
          console.warn(`   ⚠️  Suppressing further individual errors…`);
        }
      }

      // Periodic save
      if (fetchedCount % BEER_BATCH_SIZE === 0) {
        saveBeerCache(beerCache);
        saveOutput(allCheckins, beerCache);
      }

      await sleep(DELAY_MS);
    }
  } catch (err) {
    console.error(`\n❌  Error during beer enrichment: ${err.message}`);
  } finally {
    saveBeerCache(beerCache);
    console.log(
      `\n✅  Beer details: ${Object.keys(beerCache).length} cached, ${errorCount} errors`
    );

    // Re-save output with enriched data
    saveOutput(allCheckins, beerCache);
  }
}

main();
