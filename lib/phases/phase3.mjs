import { CONCURRENCY, DELAY_MS, sleep } from "../config.mjs";
import { fetchPage, pool } from "../fetch.mjs";
import { parseVenueDetails, parseBreweryDetails, parseBreweryVenueUrl, reverseGeocode, forwardGeocode } from "../parsers/locations.mjs";
import { hasLocation, writeLocation, readLocation, hasBrewery, writeBrewery, readBrewery } from "../db.mjs";
import { saveOutput } from "../storage.mjs";
import { logError } from "../logger.mjs";

const sessionTried = new Set();

// Virtual venues that have no real page and will always return 500.
// These are synthetic Untappd check-in locations — skip them entirely.
const SKIP_VENUE_URLS = new Set([
  "https://untappd.com/v/at-home/9917985", // "Untappd at Home"
]);

/**
 * Phase 3: Fetch venue and brewery detail pages for any uncached URLs.
 */
export async function phase3(allCheckins, newCheckins = null) {
  // Always scan ALL checkins for venue/brewery URLs to fetch.
  // The hasLocation/hasBrewery filters ensure only uncached entries are fetched,
  // so in a normal incremental run (cache intact) this adds zero extra requests.
  // After clearing the cache, this correctly re-fetches and re-geocodes everything
  // instead of falling back to stale embedded data in the loaded JSON.

  const venueUrls = [...new Set(
    allCheckins.flatMap((c) => [c.venue?.url, c.purchased_at?.url]).filter(Boolean)
  )].filter((u) => u.includes("/v/") && !SKIP_VENUE_URLS.has(u) && !hasLocation(u));

  const breweryUrls = [...new Set(
    allCheckins.map((c) => c.brewery?.url).filter(Boolean)
  )].filter((u) => {
    if (sessionTried.has(u)) return false;
    if (!hasBrewery(u)) return true;
    const data = readBrewery(u);
    // Re-process if coordinates are missing and it didn't previously fail permanently
    // and we haven't already confirmed no coords are available (no_coords sentinel)
    return data && data.lat === null && !data.failed && !data.no_coords;
  });

  const totalVenues    = venueUrls.length;
  const totalBreweries = breweryUrls.length;
  const total          = totalVenues + totalBreweries;

  if (total === 0) return;

  console.log(`\n📍  Phase 3: Fetching ${totalVenues} venue(s) and ${totalBreweries} brewery(ies) [${CONCURRENCY} workers]…`);

  try {
    // --- Venues ---
    if (venueUrls.length > 0) {
      const { done: vd, errorCount: ve } = await pool(
        venueUrls, "Location", total, 0, CONCURRENCY,
        async (url) => {
          try {
            const html = await fetchPage(url);
            const details = parseVenueDetails(html);

            // Reverse-geocode lat/lng → authoritative city/country (English)
            if (details.lat != null && details.lng != null) {
              const geo = await reverseGeocode(details.lat, details.lng);
              if (geo) {
                details.city    = geo.city    || details.city;
                details.country = geo.country || details.country;
              }
            } else if (details.city) {
              // Fallback: Mapbox forward geocode if city is available (user rule: city is mandatory)
              const coords = await forwardGeocode(details.city, details.country);
              if (coords) {
                details.lat = coords.lat;
                details.lng = coords.lng;
              }
            }

            writeLocation(url, details);
          } catch (err) {
            writeLocation(url, { failed: true });  // sentinel: skip on future batches
            throw err;  // let pool log it
          }
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
          sessionTried.add(url);
          let breweryData;
          try {
            const html = await fetchPage(url);
            breweryData = parseBreweryDetails(html);

            if (breweryData.lat === null) {
              const venueUrl = parseBreweryVenueUrl(html);
              if (venueUrl) {
                let venueDetails = readLocation(venueUrl);
                if (!venueDetails || venueDetails.failed) {
                  try {
                    await sleep(DELAY_MS);
                    const venueHtml = await fetchPage(venueUrl);
                    venueDetails = parseVenueDetails(venueHtml);

                    // Reverse-geocode the sub-fetched venue too
                    if (venueDetails.lat != null && venueDetails.lng != null) {
                      const vGeo = await reverseGeocode(venueDetails.lat, venueDetails.lng);
                      if (vGeo) {
                        venueDetails.city    = vGeo.city    || venueDetails.city;
                        venueDetails.country = vGeo.country || venueDetails.country;
                      }
                    }

                    writeLocation(venueUrl, venueDetails);
                  } catch (e) {
                    writeLocation(venueUrl, { failed: true });
                    console.warn(`\n   ⚠️ Failed brewery venue ${venueUrl}: ${e.message}`);
                    logError(`Failed brewery venue: ${e.message}`, venueUrl);
                  }
                }
                if (venueDetails?.lat != null) {
                  breweryData.lat = venueDetails.lat;
                  breweryData.lng = venueDetails.lng;
                }
              }
            }

            // Reverse-geocode lat/lng → English country (always), and city only
            // when it's missing from the Untappd title. When a city was already
            // extracted from the title we don't override it: brewery coordinates
            // are sometimes venue-linked approximations that may not match the
            // brewery's actual city.
            if (breweryData.lat != null && breweryData.lng != null) {
              const geo = await reverseGeocode(breweryData.lat, breweryData.lng);
              if (geo?.country) {
                breweryData.country = geo.country;
              }
              if (geo?.city && !breweryData.city) {
                breweryData.city = geo.city;
              }
            } else if (breweryData.city) {
              // Fallback: Mapbox forward geocode if city is available (user rule: city is mandatory)
              const coords = await forwardGeocode(breweryData.city, breweryData.country);
              if (coords) {
                breweryData.lat = coords.lat;
                breweryData.lng = coords.lng;
              }
            }

            // If lat is still null after all resolution attempts, mark as no_coords
            // so future runs don't try to re-fetch this brewery repeatedly.
            if (breweryData.lat === null) {
              breweryData.no_coords = true;
            }

            writeBrewery(url, breweryData);
          } catch (err) {
            if (!breweryData) writeBrewery(url, { failed: true });  // sentinel: skip on future batches
            throw err;  // let pool log it
          }
        }
      );
      process.stdout.write("\n");
      console.log(`   ✅ ${bd} breweries fetched, ${be} errors`);
    }
  } catch (err) {
    process.stdout.write("\n");
    throw err;
  }
}
