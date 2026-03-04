import { writeFileSync, appendFileSync, mkdirSync } from "fs";
import { OUTPUT_DIR, LOG_FILE } from "./config.mjs";

/**
 * Call once at the start of each scrape run.
 * Creates (or truncates) the log file and writes a timestamped header.
 */
export function initLog(label) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const header = `=== ${label} — ${new Date().toISOString()} ===\n`;
  writeFileSync(LOG_FILE, header);
}

/**
 * Append a timestamped error line to the log file.
 * Also usable for warnings — the severity prefix is up to the caller.
 *
 * @param {string} message  Human-readable description
 * @param {string} [url]    The URL that failed (optional)
 */
export function logError(message, url) {
  const ts = new Date().toISOString();
  const line = url
    ? `[${ts}] ERROR  ${message}  (${url})\n`
    : `[${ts}] ERROR  ${message}\n`;
  appendFileSync(LOG_FILE, line);
}
