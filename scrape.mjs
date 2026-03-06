import { USER, CONCURRENCY } from "./lib/config.mjs";
import { phaseIncremental } from "./lib/phases/incremental.mjs";
import { phase1 } from "./lib/phases/phase1.mjs";
import { phaseUpdateAll } from "./lib/phases/update-all.mjs";
import pkg from "./package.json" with { type: "json" };

const VERSION = pkg.version;

const INCLUDE_FLAVORS = process.argv.includes("--include-flavors");
const FULL_SCRAPE     = process.argv.includes("--full");
const UPDATE_STATS    = process.argv.includes("--stats");

async function main() {
  if (UPDATE_STATS) {
    if (INCLUDE_FLAVORS) {
      console.error(`❌  --include-flavors is not supported with --stats. Use 'npm run scrape' or 'npm run scrape:full' instead.`);
      process.exit(1);
    }
    console.log(`🔄 Untappd Scraper XL v${VERSION} — user: "${USER}" [--stats, concurrency: ${CONCURRENCY}]\n`);
    await phaseUpdateAll();
    return;
  }

  if (FULL_SCRAPE) {
    const flags = INCLUDE_FLAVORS ? " +flavors" : "";
    console.log(`🍺 Untappd Scraper XL v${VERSION} — user: "${USER}" [--full, concurrency: ${CONCURRENCY}${flags}]\n`);
    if (!INCLUDE_FLAVORS) {
      console.log(`ℹ️   Phase 4 (flavor profiles) skipped. Run with --include-flavors to enable it.\n`);
    }
    await phase1(INCLUDE_FLAVORS);
    return;
  }

  // Default: incremental (new checkins only)
  const flags = INCLUDE_FLAVORS ? " +flavors" : "";
  console.log(`⚡ Untappd Scraper XL v${VERSION} — user: "${USER}" [incremental, concurrency: ${CONCURRENCY}${flags}]\n`);
  await phaseIncremental(INCLUDE_FLAVORS);
}

main();
