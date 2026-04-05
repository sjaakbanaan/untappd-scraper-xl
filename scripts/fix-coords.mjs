/**
 * fix-coords.mjs
 *
 * Scans a checkins JSON file for locations (breweries, venues, purchased_at) 
 * with missing (null) coordinates and attempts to resolve them using 
 * Mapbox Forward Geocoding (city/country).
 *
 * Usage:
 *   node fix-coords.mjs [path/to/checkins.json] [--force] [--cleanup]
 *
 * --force: Re-geocodes all locations even if they already have coordinates.
 * --cleanup: Reverts lat/lng to null for entries that have a country but no city.
 */

import "dotenv/config";
import { readFileSync, writeFileSync } from "fs";
import { forwardGeocode } from "./lib/parsers/locations.mjs";

const filePath = process.argv.find(arg => arg.endsWith(".json")) ?? `./output/${process.env.UNTAPPD_USER}_checkins.json`;
const FORCE = process.argv.includes("--force");
const CLEANUP = process.argv.includes("--cleanup");

const DELAY_MS = 200; // Mapbox allows higher concurrency, but let's be polite
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`\n📂  Loading ${filePath}…`);
  let data;
  try {
    data = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    console.error(`❌  Cannot read ${filePath}`);
    process.exit(1);
  }

  const checkins = data.checkins ?? [];
  console.log(`🗺️   Scanning ${checkins.length} checkins for missing coordinates…\n`);

  // We group by unique city+country to avoid redundant API calls.
  // key: "city|country" -> value: { city, country, objects: [] }
  const locationMap = new Map();
  let cleanupCount = 0;

  function trackLocation(obj, type) {
    if (!obj) return;
    const { city, country, lat } = obj;
    const cityClean    = (city || "").trim();
    const countryClean = (country || "").trim();

    // Cleanup: 如果已设置坐标但没有城市 -> 还原为null
    if (CLEANUP && lat !== null && !cityClean && countryClean) {
      obj.lat = null;
      obj.lng = null;
      cleanupCount++;
      return;
    }

    // Geocoding: City is mandatory per user rule
    if ((FORCE || lat === null) && cityClean) {
      const key = `${cityClean}|${countryClean}`.toLowerCase();
      if (!locationMap.has(key)) {
        locationMap.set(key, { city: cityClean, country: countryClean, objects: [] });
      }
      locationMap.get(key).objects.push({ obj, type });
    }
  }

  for (const c of checkins) {
    trackLocation(c.brewery, "brewery");
    trackLocation(c.venue, "venue");
    trackLocation(c.purchased_at, "purchased_at");
  }

  if (CLEANUP && cleanupCount > 0) {
    console.log(`🧼  Cleaned up ${cleanupCount} country-only location(s) (reverted to null).\n`);
  }

  const toFix = Array.from(locationMap.values());

  if (toFix.length === 0) {
    if (cleanupCount > 0) {
      save(data, filePath);
    } else {
      console.log(`✅  No new locations found that need coordinate fixes.`);
    }
    return;
  }

  console.log(`  Found ${toFix.length} unique city/country pair(s) to resolve (affecting ${toFix.reduce((sum, item) => sum + item.objects.length, 0)} entries).\n`);

  let resolved = 0;
  let failed = 0;

  for (const item of toFix) {
    const { city, country, objects } = item;
    const label = `${city || "Unknown City"}, ${country || "Unknown Country"}`;
    process.stdout.write(`  🔍 Resolving ${label}…`);

    const coords = await forwardGeocode(city, country);
    if (coords) {
      for (const { obj } of objects) {
        obj.lat = coords.lat;
        obj.lng = coords.lng;
      }
      resolved++;
      process.stdout.write(` ✅ [${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}] (updated ${objects.length} refs)\n`);
    } else {
      failed++;
      process.stdout.write(` ❌ No match found\n`);
    }
    await sleep(DELAY_MS);
  }

  console.log(`\n✨ Done! ${resolved} unique locations resolved, ${failed} failed.\n`);

  if (resolved > 0 || cleanupCount > 0) {
    save(data, filePath);
  }
}

function save(data, path) {
  data.meta.scraped_at = new Date().toISOString();
  
  // Stringify and then collapse simple arrays to keep the JSON file cleaner
  let json = JSON.stringify(data, null, 2);
  
  // Collapse empty arrays: []
  json = json.replace(/\[\s+\]/g, "[]");
  
  // Collapse simple string arrays on one line: ["foo", "bar"]
  json = json.replace(/\[\s+("[^"]*"(?:,\s*"[^"]*")*)\s+\]/g, (match, p1) => {
    return `[${p1.replace(/\s+/g, " ")}]`;
  });

  writeFileSync(path, json);
  console.log(`💾  Saved updated checkins → ${path}`);
}

main();

