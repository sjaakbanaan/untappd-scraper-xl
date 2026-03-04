import { CONCURRENCY, DELAY_MS, sleep } from "../config.mjs";
import { fetchPage, pool } from "../fetch.mjs";
import { parseVenueDetails, parseBreweryDetails, parseBreweryVenueUrl } from "../parsers/locations.mjs";
import { hasLocation, writeLocation, readLocation, hasBrewery, writeBrewery, readBrewery } from "../db.mjs";
import { saveOutput } from "../storage.mjs";
import { logError } from "../logger.mjs";

const sessionTried = new Set();

/**
 * Phase 3: Fetch venue and brewery detail pages for any uncached URLs.
 */
export async function phase3(allCheckins, newCheckins = null) {
  const source = newCheckins || allCheckins;

  const venueUrls = [...new Set(
    source.flatMap((c) => [c.venue?.url, c.purchased_at?.url]).filter(Boolean)
  )].filter((u) => u.includes("/v/") && !hasLocation(u));

  const breweryUrls = [...new Set(
    source.map((c) => c.brewery?.url).filter(Boolean)
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
            writeLocation(url, parseVenueDetails(html));
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
                    writeLocation(venueUrl, venueDetails);
                  } catch (e) {
                    writeLocation(venueUrl, { failed: true });
                    console.warn(`\n   ⚠️ Failed brewery venue ${venueUrl}: ${e.message}`);
                    logError(`Failed brewery venue: ${e.message}`, venueUrl);
                  }
                }
                if (venueDetails?.lat !== null) {
                  breweryData.lat = venueDetails.lat;
                  breweryData.lng = venueDetails.lng;
                }
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
  } finally {
    saveOutput(allCheckins);
  }
}
