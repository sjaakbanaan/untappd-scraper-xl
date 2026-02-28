import * as cheerio from "cheerio";
import { USER } from "./config.mjs";

export function parseCheckins(html) {
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

    // Venue
    const $venueLink = $text.find('a[href*="/v/"]').first();
    const venueName = $venueLink.text().trim() || null;
    const venueUrl = $venueLink.attr("href")
      ? `https://untappd.com${$venueLink.attr("href")}`
      : null;

    // Purchased at
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

    // Serving type
    const $serving = $el.find("p.serving span");
    const servingType = $serving.length ? $serving.text().trim() : null;

    // User comment
    const $commentBlock = $el.find(".checkin-comment").clone();
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

    // Toasts
    const $cheers = $el.find(".cheers");
    const toastCount = Number($cheers.find(".count span").text().trim()) || 0;
    const toastUsers = [];
    $cheers.find("a.user-toasts").each((_, a) => {
      const username = $(a).attr("data-user-name");
      if (username) toastUsers.push(username);
    });

    // Tagged friends
    const taggedFriends = [];
    $el.find(".tagged-friends a[href*='/user/']").each((_, a) => {
      const href = $(a).attr("href") || "";
      const username = href.split("/user/")[1]?.replace(/\/$/, "");
      if (username) taggedFriends.push(username);
    });

    // Badges
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

    checkins.push({
      checkin_id: checkinId,
      checkin_url: `https://untappd.com/user/${USER}/checkin/${checkinId}`,
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
      venue: venueName ? { name: venueName, url: venueUrl } : null,
      purchased_at: purchasedAt,
      rating,
      serving_type: servingType,
      comment,
      photo_url: photoUrl,
      toasts: { count: toastCount, users: toastUsers },
      comment_count: $el.find(".comments .comments-container .comment").length,
      tagged_friends: taggedFriends,
      badges,
    });
  });

  return checkins;
}

export function parseBeerDetails(html) {
  const $ = cheerio.load(html);
  const $content = $(".content");

  const $globalCaps = $content.find(".details .caps[data-rating]");
  const globalRating = $globalCaps.length ? Number($globalCaps.attr("data-rating")) : null;

  const abvText = $content.find("p.abv").text().trim();
  const abvMatch = abvText.match(/([\d.]+)\s*%/);
  const abv = abvMatch ? Number(abvMatch[1]) : null;

  const ibuText = $content.find("p.ibu").text().trim();
  const ibuMatch = ibuText.match(/(\d+)\s*IBU/);
  const ibu = ibuMatch ? Number(ibuMatch[1]) : null;

  const style = $content.find("p.style").text().trim() || null;
  const description = $content.find(".beer-descrption-read-more").text().trim() || null;

  const ratersText = $content.find("p.raters").text().trim();
  const ratersMatch = ratersText.match(/([\d,]+)\s*Rating/i);
  const totalRatings = ratersMatch ? Number(ratersMatch[1].replace(/,/g, "")) : null;

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

/**
 * Extract lat/lng from a Google Maps URL found in an <a data-track="venue"> link.
 * Handles formats used by Untappd:
 *   https://www.google.com/maps?near=52.0945587,5.1205621&q=...
 *   https://maps.google.com/maps?ll=52.123,4.456
 *   https://www.google.com/maps/place/.../@52.123,4.456,17z/...
 */
function extractLatLng(href) {
  if (!href) return { lat: null, lng: null };

  // near=lat,lng (Untappd's actual format)
  let m = href.match(/[?&]near=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };

  // @lat,lng (Google Maps place URLs)
  m = href.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };

  // ll=lat,lng
  m = href.match(/[?&]ll=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };

  return { lat: null, lng: null };
}

/**
 * Clean up an address string: strip the ( Map ) link text and normalize whitespace.
 */
function cleanAddress(raw) {
  if (!raw) return null;
  return raw
    .replace(/\([^)]*\)/g, "")  // remove anything in parentheses e.g. ( Map )
    .replace(/[\t]+/g, " ")      // tabs → spaces
    .replace(/\s{2,}/g, " ")     // collapse multiple spaces
    .trim() || null;
}

/**
 * Parse address and coordinates from a venue or brewery page.
 * Shared helper used by both parseVenueDetails and parseBreweryDetails.
 */
function parseLocationInfo($, addressSelector = "p.address") {
  const $mapLink = $('a[data-track="venue"]').first();
  const mapHref = $mapLink.attr("href") || null;
  const { lat, lng } = extractLatLng(mapHref);

  // Get raw address text from the paragraph, excluding the link text
  const $addrEl = $(addressSelector).first();
  // Clone and remove the map link so we only get the plain text
  const $addrClone = $addrEl.clone();
  $addrClone.find("a").remove();
  const address = cleanAddress($addrClone.text()) || cleanAddress($addrEl.text());

  return { address, lat, lng };
}

/**
 * Parse a venue page (https://untappd.com/v/...).
 */
export function parseVenueDetails(html) {
  const $ = cheerio.load(html);

  const name =
    $(".venue-detail h1, .venue-name h1, .venue h1, h1.title").first().text().trim() ||
    $("title").text().split("|")[0].trim() ||
    null;

  const { address, lat, lng } = parseLocationInfo($);

  return { name, address, lat, lng };
}

/**
 * Parse a brewery page (https://untappd.com/DeKrommeHaring or /w/...).
 */
export function parseBreweryDetails(html) {
  const $ = cheerio.load(html);

  const name =
    $(".brewery-name h1, .brewery-detail h1, .brewery h1, h1.brewery-title, h1.title").first().text().trim() ||
    $("title").text().split("|")[0].trim() ||
    null;

  // Brewery pages use p.brewery for the address block
  const { address, lat, lng } = parseLocationInfo($, "p.brewery");

  return { name, address, lat, lng };
}

/**
 * Extract the first /v/ venue URL embedded in a brewery's "Brewery Locations"
 * sidebar. Returns a full URL like https://untappd.com/v/brewdog-brewery/496318,
 * or null if none found.
 */
export function parseBreweryVenueUrl(html) {
  const $ = cheerio.load(html);
  const $link = $(".content .item a[href*=\"/v/\"]").first();
  const href = $link.attr("href");
  return href ? `https://untappd.com${href}` : null;
}

/**
 * Parse the flavor profile tags from an individual checkin page.
 * Returns an array of flavor strings, e.g. ["Hoppy", "Grapefruity"].
 */
export function parseCheckinFlavors(html) {
  const $ = cheerio.load(html);
  const flavors = [];
  $(".flavor ul li span").each((_, el) => {
    const text = $(el).text().trim();
    if (text) flavors.push(text);
  });
  return flavors;
}
