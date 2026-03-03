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

// Country names that appear as the final word(s) in an Untappd address segment.
// Covers all countries encountered in this dataset plus common multi-word names.
export const KNOWN_COUNTRIES = new Set([
  "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Argentina",
  "Armenia", "Australia", "Austria", "Azerbaijan", "Belarus", "Belgium",
  "Belize", "Bolivia", "Bosnia", "Botswana", "Brazil", "Bulgaria",
  "Cambodia", "Cameroon", "Canada", "Chile", "China", "Colombia",
  "Croatia", "Cuba", "Cyprus", "Denmark", "Ecuador", "Egypt", "England",
  "Estonia", "Ethiopia", "Finland", "France", "Georgia", "Germany",
  "Ghana", "Greece", "Guatemala", "Honduras", "Hungary", "Iceland",
  "India", "Indonesia", "Iran", "Iraq", "Ireland", "Israel", "Italy",
  "Jamaica", "Japan", "Jordan", "Kazakhstan", "Kenya", "Kosovo",
  "Latvia", "Lebanon", "Liechtenstein", "Lithuania", "Luxembourg",
  "Madagascar", "Malaysia", "Malta", "Mexico", "Moldova", "Monaco",
  "Montenegro", "Morocco", "Nederland", "Netherlands", "Nicaragua", "Nigeria",
  "Norway", "Pakistan", "Panama", "Paraguay", "Peru", "Philippines",
  "Poland", "Portugal", "Romania", "Russia", "Scotland", "Serbia",
  "Singapore", "Slovakia", "Slovenia", "Spain", "Sweden", "Switzerland",
  "Taiwan", "Thailand", "Tunisia", "Turkey", "Uganda", "Ukraine",
  "Uruguay", "Venezuela", "Vietnam", "Wales", "Zambia", "Zimbabwe",
  // Multi-word country/territory names:
  "United States", "United Kingdom", "United Arab Emirates",
  "New Zealand", "Costa Rica", "Czech Republic", "South Africa",
  "South Korea", "North Korea", "North Macedonia", "Northern Ireland",
  "El Salvador", "Dominican Republic", "Trinidad and Tobago",
  "Bosnia and Herzegovina", "Papua New Guinea",
  "Principality of Monaco",
  "People's Republic of China", "China / People's Republic of China",
]);

/**
 * Given an "addressLocality" string from schema.org (e.g. "Utrecht Nederland"
 * or "Wrocław Poland"), split it into { city, country } by scanning from the
 * right for a known country name (handles multi-word countries).
 * Falls back to { city: full string, country: "" } if no country matched.
 */
function splitLocalityCountry(locality) {
  if (!locality) return { city: "", country: "" };
  const words = locality.trim().split(/\s+/);

  // Try progressively larger trailing phrases as the country
  for (let take = words.length - 1; take >= 1; take--) {
    const country = words.slice(take).join(" ");
    if (KNOWN_COUNTRIES.has(country)) {
      const city = words.slice(0, take).join(" ").trim();
      return { city, country };
    }
  }

  // No country matched — treat entire string as city
  return { city: locality.trim(), country: "" };
}

// ── Strategy 1: UTFB demo-request URL ────────────────────────────────────────

/**
 * Try to extract city + country from the "Request a Demo" button href inside
 * .venue-own.  The URL contains query params like:
 *   ?...&city=Utrecht&country=Nederland&...
 * Returns { city, country } or null if the element/params are absent.
 */
function extractFromUtfbLink($) {
  const $venueOwn = $(".venue-own");
  if (!$venueOwn.length) return null;

  const href = $venueOwn.find("a[href*='utfb.untappd.com']").attr("href");
  if (!href) return null;

  try {
    // The href may use &amp; in HTML – cheerio usually decodes it, but just in case:
    const decoded = href.replace(/&amp;/g, "&");
    const url = new URL(decoded);
    const city    = url.searchParams.get("city")    ?? "";
    const country = url.searchParams.get("country") ?? "";
    if (country) return { city, country };
  } catch {
    // malformed URL — fall through
  }
  return null;
}

// ── Strategy 2: schema.org JSON-LD ───────────────────────────────────────────

/**
 * Try to extract city + country from the schema.org JSON-LD embedded in the page.
 * Looks for a script[type="application/ld+json"] containing a PostalAddress.
 * `addressLocality` holds "City Country" so we split with splitLocalityCountry().
 * Returns { city, country } or null if not found / cannot parse.
 */
function extractFromSchemaOrg($) {
  let result = null;

  $('script[type="application/ld+json"]').each((_, el) => {
    if (result) return; // already found one
    try {
      const json = JSON.parse($(el).html());
      const address = json?.address;
      if (!address) return;

      const locality = address.addressLocality ?? "";
      if (locality) {
        result = splitLocalityCountry(locality);
      }
    } catch {
      // ignore parse errors
    }
  });

  return result;
}

// ── Strategy 3: legacy p.address / p.brewery fallback ────────────────────────

/**
 * Extract city + country from a legacy Untappd address string like:
 *   "Amsterdamsestraatweg Utrecht, Utrecht, Nederland"
 *   "Nederland"
 *   "Brooklyn, NY, United States"
 *
 * We use the last comma-segment as the country and the second-to-last as the city.
 * Falls back to the country list for multi-word detection if needed.
 */
function extractFromLegacyAddress(raw) {
  if (!raw) return { city: "", country: "" };

  // Clean up whitespace
  const cleaned = raw
    .replace(/\([^)]*\)/g, "")   // remove ( Map ) etc.
    .replace(/[\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!cleaned) return { city: "", country: "" };

  const parts = cleaned.split(",").map((p) => p.trim()).filter(Boolean);

  if (parts.length === 0) return { city: "", country: "" };

  if (parts.length === 1) {
    // Only one segment — could be just a country name
    const only = parts[0];
    if (KNOWN_COUNTRIES.has(only)) return { city: "", country: only };
    return { city: only, country: "" };
  }

  // Multiple segments: last segment is the country candidate
  let country = parts[parts.length - 1];
  let city    = parts[parts.length - 2] ?? "";

  // If the last segment isn't a recognised country, try splitting it further
  if (!KNOWN_COUNTRIES.has(country)) {
    const words = country.split(/\s+/);
    for (let take = words.length - 1; take >= 1; take--) {
      const candidate = words.slice(take).join(" ");
      if (KNOWN_COUNTRIES.has(candidate)) {
        // The left part becomes additional city info; the right part is country
        city    = words.slice(0, take).join(" ").trim() || city;
        country = candidate;
        break;
      }
    }
  }

  return { city, country };
}

// ── Shared location parser ────────────────────────────────────────────────────

/**
 * Parse city, country and coordinates from a venue or brewery page.
 * Priority: UTFB link → schema.org → legacy address text.
 */
function parseLocationInfo($, legacyAddressSelector = "p.address") {
  // --- Coordinates ---
  const $mapLink = $('a[data-track="venue"]').first();
  const mapHref  = $mapLink.attr("href") || null;
  const { lat, lng } = extractLatLng(mapHref);

  // --- city / country ---
  let cityCountry =
    extractFromUtfbLink($) ??
    extractFromSchemaOrg($) ??
    (() => {
      const $addrEl    = $(legacyAddressSelector).first();
      const $addrClone = $addrEl.clone();
      $addrClone.find("a").remove();
      const text = ($addrClone.text() || $addrEl.text()).trim();
      return text ? extractFromLegacyAddress(text) : null;
    })();

  const city    = cityCountry?.city    ?? "";
  const country = cityCountry?.country ?? "";

  return { city, country, lat, lng };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a venue page (https://untappd.com/v/...).
 * Returns { name, city, country, lat, lng }.
 */
export function parseVenueDetails(html) {
  const $ = cheerio.load(html);

  const name =
    $(".venue-detail h1, .venue-name h1, .venue h1, h1.title").first().text().trim() ||
    $("title").text().split("|")[0].trim() ||
    null;

  const { city, country, lat, lng } = parseLocationInfo($);

  return { name, city, country, lat, lng };
}

/**
 * Parse a brewery page (https://untappd.com/DeKrommeHaring or /w/...).
 * Returns { name, city, country, lat, lng }.
 */
export function parseBreweryDetails(html) {
  const $ = cheerio.load(html);

  const name =
    $(".brewery-name h1, .brewery-detail h1, .brewery h1, h1.brewery-title, h1.title").first().text().trim() ||
    $("title").text().split("|")[0].trim() ||
    null;

  // Brewery pages use p.brewery for the address block
  const { city, country, lat, lng } = parseLocationInfo($, "p.brewery");

  return { name, city, country, lat, lng };
}

/**
 * Extract the first /v/ venue URL embedded in a brewery's "Brewery Locations"
 * sidebar. Returns a full URL or null if none found.
 */
export function parseBreweryVenueUrl(html) {
  const $ = cheerio.load(html);
  
  // Look for the "Brewery Locations" or "Popular Locations" heading specifically in the sidebar
  const $heading = $(".sidebar h3").filter((i, el) => {
    const text = $(el).text();
    return text.includes("Brewery Locations") || text.includes("Popular Locations");
  });
  if ($heading.length > 0) {
    const $section = $heading.parent();
    const $link = $section.find("a[href*=\"/v/\"]").first();
    if ($link.length > 0) {
      const href = $link.attr("href");
      return href ? `https://untappd.com${href}` : null;
    }
  }

  // Fallback to searching for any /v/ link in the sidebar that isn't Untappd at Home
  const $links = $(".sidebar a[href*=\"/v/\"]");
  for (let i = 0; i < $links.length; i++) {
    const $link = $($links[i]);
    const href = $link.attr("href");
    const text = $link.text().toLowerCase();
    if (href && !text.includes("untappd at home")) {
      return `https://untappd.com${href}`;
    }
  }

  return null;
}

// Keep normalizeAddress exported for any callers that still use it directly
export function normalizeAddress(str) { return str; }
