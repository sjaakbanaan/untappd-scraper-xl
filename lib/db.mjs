import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { BEERS_DIR, LOCATIONS_DIR, BREWERIES_DIR } from "./config.mjs";

// ── ID / slug extractors ────────────────────────────────────────────────────

/**
 * Extract numeric beer ID from a beer URL.
 * e.g. https://untappd.com/b/de-kromme-haring-barbarian/6599834 → "6599834"
 */
export function extractBeerId(url) {
  if (!url) return null;
  const m = url.match(/\/b\/[^/]+\/(\d+)/);
  return m ? m[1] : null;
}

/**
 * Extract numeric venue ID from a venue URL.
 * e.g. https://untappd.com/v/eagerly-internet/8632005 → "8632005"
 */
export function extractVenueId(url) {
  if (!url) return null;
  const m = url.match(/\/v\/[^/]+\/(\d+)/);
  return m ? m[1] : null;
}

/**
 * Extract brewery slug from a brewery URL.
 * e.g. https://untappd.com/DeKrommeHaring → "DeKrommeHaring"
 * e.g. https://untappd.com/w/cafe-de-zaak/28624 → "w-cafe-de-zaak-28624"
 */
export function extractBrewerySlug(url) {
  if (!url) return null;
  const path = new URL(url).pathname.replace(/^\//, "").replace(/\//g, "-");
  return path || null;
}

// ── Low-level read / write ──────────────────────────────────────────────────

export function hasEntity(dir, key) {
  return existsSync(`${dir}/${key}.json`);
}

export function readEntity(dir, key) {
  const file = `${dir}/${key}.json`;
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

export function writeEntity(dir, key, data) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${key}.json`, JSON.stringify(data, null, 2));
}

// ── Convenience wrappers ────────────────────────────────────────────────────

export function readBeer(beerUrl) {
  const id = extractBeerId(beerUrl);
  return id ? readEntity(BEERS_DIR, id) : null;
}

export function writeBeer(beerUrl, data) {
  const id = extractBeerId(beerUrl);
  if (id) writeEntity(BEERS_DIR, id, { beer_url: beerUrl, ...data });
}

export function hasBeer(beerUrl) {
  const id = extractBeerId(beerUrl);
  return id ? hasEntity(BEERS_DIR, id) : false;
}

export function readLocation(venueUrl) {
  const id = extractVenueId(venueUrl);
  return id ? readEntity(LOCATIONS_DIR, id) : null;
}

export function writeLocation(venueUrl, data) {
  const id = extractVenueId(venueUrl);
  if (id) writeEntity(LOCATIONS_DIR, id, { venue_url: venueUrl, ...data });
}

export function hasLocation(venueUrl) {
  const id = extractVenueId(venueUrl);
  return id ? hasEntity(LOCATIONS_DIR, id) : false;
}

export function readBrewery(breweryUrl) {
  const slug = extractBrewerySlug(breweryUrl);
  return slug ? readEntity(BREWERIES_DIR, slug) : null;
}

export function writeBrewery(breweryUrl, data) {
  const slug = extractBrewerySlug(breweryUrl);
  if (slug) writeEntity(BREWERIES_DIR, slug, { brewery_url: breweryUrl, ...data });
}

export function hasBrewery(breweryUrl) {
  const slug = extractBrewerySlug(breweryUrl);
  return slug ? hasEntity(BREWERIES_DIR, slug) : false;
}
