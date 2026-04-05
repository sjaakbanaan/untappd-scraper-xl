import * as cheerio from "cheerio";
import { MAPBOX_KEY } from "../config.mjs";

// ── Private helpers ──────────────────────────────────────────────────────────

/**
 * Two-letter abbreviations for all 50 US states + DC + common territories.
 * Used to detect "City, ST" patterns in brewery name suffixes.
 */
const US_STATE_ABBREVS = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
  "DC","PR","VI","GU","AS","MP",
]);

/**
 * Extract { city, state, country } from the standard Untappd brewery title
 * suffix: "Brewery Name - City, ST - Untappd"  (US)
 *          "Brewery Name - Country - Untappd"   (non-US, no city)
 *          "Brewery Name - City Country - Untappd" (non-US with city)
 *
 * Returns null when the pattern doesn't match.
 */
export function parseBreweryNameSuffix(name) {
  if (!name) return null;

  // Strip trailing " - Untappd" (case-insensitive)
  const withoutSuffix = name.replace(/\s+-\s+Untappd\s*$/i, "").trim();

  // Find the LAST " - " separator — everything after it is the location segment
  const lastDash = withoutSuffix.lastIndexOf(" - ");
  if (lastDash === -1) return null;

  const locationSegment = withoutSuffix.slice(lastDash + 3).trim();
  if (!locationSegment) return null;

  // Case 1: "City, ST"  (US two-letter state abbreviation)
  const usMatch = locationSegment.match(/^(.+),\s*([A-Z]{2})$/);
  if (usMatch && US_STATE_ABBREVS.has(usMatch[2])) {
    return { city: usMatch[1].trim(), state: usMatch[2], country: "United States" };
  }

  // Case 2: the segment is a known country (e.g. "Netherlands", "Germany")
  if (KNOWN_COUNTRIES.has(locationSegment)) {
    return { city: "", state: "", country: locationSegment };
  }

  // Case 3: "City Country" — try to split off a trailing known country
  const words = locationSegment.split(/\s+/);
  for (let take = words.length - 1; take >= 1; take--) {
    const candidate = words.slice(take).join(" ");
    if (KNOWN_COUNTRIES.has(candidate)) {
      return { city: words.slice(0, take).join(" ").trim(), state: "", country: candidate };
    }
  }

  // Case 4: unknown — return as city only, no country inferred
  return { city: locationSegment, state: "", country: "" };
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
  "Montenegro", "Morocco", "Netherlands", "Nicaragua", "Nigeria",
  "Norway", "Pakistan", "Panama", "Paraguay", "Peru", "Philippines",
  "Poland", "Portugal", "Romania", "Russia", "Scotland", "Serbia",
  "Singapore", "Slovakia", "Slovenia", "Spain", "Sweden", "Switzerland",
  "Taiwan", "Thailand", "Tunisia", "Turkey", "Uganda", "Ukraine",
  "Uruguay", "Venezuela", "Vietnam", "Wales", "Zambia", "Zimbabwe",
  "Surinam", "Suriname", "Bahamas", "Bahrain", "Bangladesh", "Barbados", "Benin", 
  "Bhutan", "Burundi", "Chad", "Comoros", "Djibouti", "Eritrea", "Eswatini",
  "Fiji", "Gabon", "Greenland", "Guinea", "Guyana", "Haiti", "Kiribati", "Kuwait",
  "Kyrgyzstan", "Laos", "Lesotho", "Liberia", "Macao", "Macau",
  "Maldives", "Mali", "Mauritania", "Mauritius", "Mongolia", "Mozambique",
  "Myanmar", "Namibia", "Nauru", "Nepal", "Niger", "Oman", "Palau",
  "Qatar", "Rwanda", "Samoa", "Senegal", "Seychelles", "Somalia",
  "Sudan", "Syria", "Tajikistan", "Tanzania", "Togo", "Tonga",
  "Turkmenistan", "Tuvalu", "Uzbekistan", "Vanuatu", "Yemen", "Germany", "Belgium",
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
 *
 * NOTE: This is a best-effort fallback. The primary city/country resolution
 * uses reverse geocoding from lat/lng (see reverseGeocode). This parser may
 * return incorrect results for localized country names (e.g. "Deutschland",
 * "Danmark", "België") — those are corrected by the geocoder in Phase 3.
 *
 * Falls back to { city: full string, country: "" } if no country matched.
 */
function splitLocalityCountry(locality) {
  if (!locality) return { city: "", country: "" };
  const words = locality.trim().split(/\s+/);

  // Try longer trailing phrases first (most specific) so multi-word countries
  // like "Northern Ireland" win over single-word ones like "Ireland".
  for (let take = 1; take <= words.length; take++) {
    const country = words.slice(take).join(" ");
    if (country && KNOWN_COUNTRIES.has(country)) {
      const city = words.slice(0, take).join(" ").trim();
      return { city, country };
    }
  }

  // Check if the entire string is a known country (e.g. "Nederland")
  if (KNOWN_COUNTRIES.has(locality.trim())) {
    return { city: "", country: locality.trim() };
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
    // Try longer phrases first so "Northern Ireland" beats "Ireland"
    for (let take = 1; take <= words.length - 1; take++) {
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
 * Returns { name, city, state, country, lat, lng }.
 */
export function parseBreweryDetails(html) {
  const $ = cheerio.load(html);

  const name =
    $(".brewery-name h1, .brewery-detail h1, .brewery h1, h1.brewery-title, h1.title").first().text().trim() ||
    $("title").text().split("|")[0].trim() ||
    null;

  // Brewery pages use p.brewery for the address block
  let { city, country, lat, lng } = parseLocationInfo($, "p.brewery");

  // Fall back to the name's " - City, ST - Untappd" suffix when the page
  // address block yields no country (common for US breweries).
  let state = "";
  if (!country) {
    const fromName = parseBreweryNameSuffix(name);
    if (fromName) {
      if (!city)    city    = fromName.city;
      if (!country) country = fromName.country;
      state = fromName.state ?? "";
    }
  }

  return { name, city, state, country, lat, lng };
}

/**
 * Extract the first /v/ venue URL embedded in a brewery's "Brewery Locations"
 * sidebar. Returns a full URL or null if none found.
 */
export function parseBreweryVenueUrl(html) {
  const $ = cheerio.load(html);
  
  // Look for the "Brewery Locations" heading specifically in the sidebar.
  // We EXCLUDE "Popular Locations" because those are often bars where the beer
  // is sold, not where the brewery is actually located.
  const $heading = $(".sidebar h3").filter((i, el) => {
    return $(el).text().trim() === "Brewery Locations";
  });

  if ($heading.length > 0) {
    const $section = $heading.parent();
    const $link = $section.find("a[href*=\"/v/\"]").first();
    const href = $link.attr("href");
    if (href) {
      return `https://untappd.com${href}`;
    }
  }

  return null;
}

// Keep normalizeAddress exported for any callers that still use it directly
export function normalizeAddress(str) { return str; }

// ── Reverse geocoding (primary city/country resolution) ─────────────────────

/**
 * Constituent country names that should be used *instead* of their sovereign
 * state when Nominatim's `address.state` matches one of these values.
 *
 * Examples: Scotland / Wales / Northern Ireland / England are part of the
 * United Kingdom but are commonly treated as distinct countries.
 * Add others here if they come up (e.g. "Faroe Islands", "Greenland").
 */
const CONSTITUENT_COUNTRIES = new Set([
  // British Isles
  "Scotland", "Wales", "England", "Northern Ireland",
  // Danish realm
  "Faroe Islands", "Greenland",
  // Dutch kingdom (Caribbean)
  "Aruba", "Curaçao", "Sint Maarten",
  // French overseas
  "French Guiana", "Martinique", "Guadeloupe", "Réunion", "Mayotte",
  // US territories sometimes returned as state
  "Puerto Rico", "Guam", "U.S. Virgin Islands",
]);

/**
 * Resolve lat/lng coordinates to { city, country } using Mapbox Geocoding API.
 * This is faster than Nominatim and allows for higher concurrency.
 *
 * Returns { city, country } or null if the request fails.
 */
export async function reverseGeocode(lat, lng) {
  if (lat == null || lng == null || !MAPBOX_KEY) return null;

  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_KEY}&types=address,place,locality,neighborhood&language=en`;
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 429) {
        console.warn("\n   ⚠️ Mapbox rate limit reached.");
      }
      return null;
    }

    const data = await res.json();
    const feature = data.features?.[0];
    if (!feature) return null;

    let city = "";
    let country = "";
    let stateName = "";

    if (feature.id.startsWith("place.")) {
      city = feature.text;
    }

    const context = feature.context || [];
    const placeCtx = context.find(c => c.id.startsWith("place."));
    const regionCtx = context.find(c => c.id.startsWith("region."));
    const countryCtx = context.find(c => c.id.startsWith("country."));

    if (!city) city = placeCtx?.text || "";
    stateName = regionCtx?.text || "";
    country = CONSTITUENT_COUNTRIES.has(stateName) ? stateName : (countryCtx?.text || "");

    return { city, country };
  } catch (err) {
    return null;
  }
}

/**
 * Resolve a city and country name to { lat, lng } coordinates using Mapbox Forward Geocoding.
 * Uses types=place to find the geographic center of the city.
 *
 * Returns { lat, lng } or null if no match is found.
 */
/**
 * Resolve a city and country name to { lat, lng } coordinates using Mapbox Forward Geocoding.
 * Sequentially tries different feature types (place -> locality/district -> unrestricted) 
 * to maximize the chances of finding coordinates while preferring city centers.
 *
 * Returns { lat, lng } or null if no match is found.
 */
export async function forwardGeocode(city, country) {
  // City is mandatory for forward geocoding to avoid broad country-center matches
  if (!city || !MAPBOX_KEY) return null;

  const query = [city, country].filter(Boolean).join(", ");
  
  // Define type attempts based on what information we have
  let typeAttempts = [];
  if (city && country) {
    typeAttempts = ["place", "district,locality,neighborhood", ""];
  } else if (country) {
    typeAttempts = ["country", "place", ""];
  } else {
    typeAttempts = ["place", "district,locality,neighborhood", ""];
  }

  for (const type of typeAttempts) {
    try {
      const typeParam = type ? `&types=${type}` : "";
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_KEY}${typeParam}&limit=3&language=en`;
      const res = await fetch(url);
      if (!res.ok) continue;

      const data = await res.json();
      if (!data.features?.length) continue;

      // Find the best feature that matches the requested country (if provided)
      let bestFeature = null; 
      if (country) {
        bestFeature = data.features.find(f => {
          const context = f.context ?? [];
          const countryCtx = context.find(c => c.id.startsWith("country."));
          const returnedCountry = (countryCtx?.text || "").toLowerCase();
          const targetCountry = country.toLowerCase();

          if (returnedCountry === targetCountry) return true;

          // Special case: "England", "Scotland", etc. should match "United Kingdom"
          const UK_VARIANTS = ["england", "scotland", "wales", "northern ireland"];
          if (UK_VARIANTS.includes(targetCountry) && returnedCountry === "united kingdom") {
            return true;
          }

          return false;
        });
        
        // Final fallback if it's a country-type search and the feature is a country
        if (!bestFeature && type === "country") {
          const f = data.features[0];
          if (f.id.startsWith("country.") && f.text.toLowerCase().includes(country.toLowerCase())) {
            bestFeature = f;
          }
        }
      } else {
        bestFeature = data.features[0];
      }

      if (bestFeature && bestFeature.center) {
        const [lng, lat] = bestFeature.center;
        return { lat, lng };
      }
    } catch (err) {
      // Continue to next attempt on error
    }
  }

  return null;
}
