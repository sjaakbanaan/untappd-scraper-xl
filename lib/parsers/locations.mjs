import * as cheerio from "cheerio";

// ── Private helpers ──────────────────────────────────────────────────────────

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

  const $addrEl = $(addressSelector).first();
  const $addrClone = $addrEl.clone();
  $addrClone.find("a").remove();
  const address = cleanAddress($addrClone.text()) || cleanAddress($addrEl.text());

  return { address, lat, lng };
}

// ── Public API ───────────────────────────────────────────────────────────────

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
 * sidebar. Returns a full URL or null if none found.
 */
export function parseBreweryVenueUrl(html) {
  const $ = cheerio.load(html);
  const $link = $(".content .item a[href*=\"/v/\"]").first();
  const href = $link.attr("href");
  return href ? `https://untappd.com${href}` : null;
}
