import { USER, CONCURRENCY } from "./lib/config.mjs";
import { phase1 } from "./lib/phases/phase1.mjs";
import { phaseUpdateAll } from "./lib/phases/update-all.mjs";

const INCLUDE_FLAVORS = process.argv.includes("--include-flavors");
const UPDATE_ALL      = process.argv.includes("--update-all");

async function main() {
  if (UPDATE_ALL) {
    console.log(`🔄 Untappd Scraper XL — user: "${USER}" [--update-all, concurrency: ${CONCURRENCY}]\n`);
    await phaseUpdateAll();
    return;
  }

  const flags = INCLUDE_FLAVORS ? " +flavors" : "";
  console.log(`🍺 Untappd Scraper XL — user: "${USER}" [concurrency: ${CONCURRENCY}${flags}]\n`);
  if (!INCLUDE_FLAVORS) {
    console.log(`ℹ️   Phase 4 (flavor profiles) skipped. Run with --include-flavors to enable it.\n`);
  }
  await phase1(INCLUDE_FLAVORS);
}

main();
