# Untappd Scraper XL v0.9.6

Scrape **all** your Untappd checkins into a rich, structured JSON file, so you can import it into tools like [Untappd Data Visualised](https://github.com/sjaakbanaan/untappd-data-visualised). 

## How this works (for non-developers)

If you've never used a script like this before, here is a quick overview:

- **Scraping:** This script automatically browses your Untappd feed and extracts all the data, saving you from doing it manually.
- **npm:** To run this script on your computer, you need to install [Node.js](https://nodejs.org/), which includes `npm`. This lets you run commands like `npm run scrape` in your terminal.
- **JSON:** The extracted data is saved in a `.json` file, which is a standard data format that other applications (like data visualization tools) can easily read.

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env` and fill in your Untappd credentials:

| Variable         | Description                                                                        |
| ---------------- | ---------------------------------------------------------------------------------- |
| `UNTAPPD_COOKIE` | Your session cookie (see below)                                                    |
| `UNTAPPD_USER`   | Your Untappd username (only works with the cookie from the same user)              |
| `MAPBOX_KEY`     | *(Optional)* Your [Mapbox Access Token](https://account.mapbox.com/) for geocoding |

### Getting your session cookies

Check out this video to see how to fetch your your cookies:

https://github.com/user-attachments/assets/46701bff-762f-408a-9e40-439aa769cc54

1. Log into [untappd.com](https://untappd.com) in your browser
2. Open DevTools → **Network** tab
3. Reload the page
4. Click on the 'Doc' filter button and click on the source that starts with 'stats?id=12345...'
5. Under **Request Headers**, copy the full `Cookie:` value
6. Paste it into `.env` as `UNTAPPD_COOKIE="…"`

Another option is to run the following script to fetch the needed cookies and add it to your .env file.
Make sure you add your username to the .env first before running  it.

While being logged into Untappd in a local browser, try:

```bash
npm run cookie
```

This scans common Chrome-family and Firefox profiles on macOS, Linux, and Windows, then updates `UNTAPPD_COOKIE` in `.env` with the `cf_clearance`, `ut_d_l`, and `_ALGOLIA` values used by the scraper.

Useful options:

```bash
npm run cookie -- --browser firefox
npm run cookie -- --browser chrome --profile "Profile 1"
npm run --silent cookie -- --print
npm run cookie -- --dry-run
```

`--print` writes only the ready-to-paste `Cookie` header to standard output.

Notes:

- The helper needs a modern Node.js version with built-in SQLite support.
- Firefox is the most portable option because its cookies are stored in a readable SQLite database.
- Chrome, Edge, Brave, Chromium, and Arc encrypt cookies with OS-protected keys. The helper handles common macOS, Linux, and Windows formats, but newer Windows Chrome-family profiles may use App-Bound Encryption that blocks external cookie export. If that happens, use Firefox or copy the cookie manually.

## Usage

### First time

```bash
npm run scrape:full
```

This paginates your **entire** Untappd feed from newest to oldest, fetches beer/venue/brewery details, and writes `output/<username>_checkins.json`. Depending on your history this can take a while (approx. 25 minutes for 1000 checkins). This only needs to be done once.

You can stop the script at any time by pressing `Ctrl+C`. The script will save the progress it has made so far and you can continue where you left off by running `npm run scrape:full` again.

### Keeping up to date

```bash
npm run scrape
```

Scrapes the feed from the top and **stops as soon as it hits a checkin already in your output file**. New checkins are merged in automatically. Run this after every drinking session.

### All commands

| Script                 | Flag        | What it does                                                                                   |
| ---------------------- | ----------- | ---------------------------------------------------------------------------------------------- |
| `npm run cookie`       | *(none)*    | **Cookie helper** — fetch the current Untappd cookie from your browser and write it to `.env`  |
| `npm run scrape`       | *(default)* | **Incremental** — fetch only new checkins, stop at first known one, merge into existing output |
| `npm run scrape:full`  | `--full`    | **Full scrape** — paginate the entire feed newest → oldest                                     |
| `npm run scrape:stats` | `--stats`   | **Stats refresh** — re-scrape live beer stats, toasts & comments for every existing checkin    |

```bash
# Optional: also scrape per-checkin flavor profiles (scrape and scrape:full only)
npm run scrape -- --include-flavors
npm run scrape:full -- --include-flavors
```

### Incremental mode (`npm run scrape`)

Loads the existing output file, scrapes from the top, and stops the moment it hits a known checkin ID. On the very first run (no output file yet) it silently falls back to a full scrape.

### Full scrape (`npm run scrape:full`)

Paginates the entire feed in batches, running phases 2–3 (and optionally 4) after every flush:

1. **Phase 1 — Checkin feed**: Paginates until the feed is exhausted.
2. **Phase 2 — Beer details**: Fetches each unique beer page not yet in `output/db/beers/`.
3. **Phase 3 — Venue & brewery details**: Fetches venue/brewery pages not yet cached in `output/db/locations/` and `output/db/breweries/`.
4. **Phase 4 — Flavor profiles** *(opt-in, `--include-flavors`)*: Fetches individual checkin pages for flavor tags; cached in `output/db/checkins/`.

### Stats refresh (`npm run scrape:stats`)

Loads the existing output file and re-scrapes only the fields that change over time, without touching the rest of your data:

| Sub-phase                | Pages fetched                              | Fields refreshed                                                                             |
| ------------------------ | ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| **A — Beer stats**       | Beer pages (unique per beer)               | `global_rating`, `global_rating_count`, `total_checkins`, `unique_users`, `monthly_checkins` |
| **B — Checkin activity** | Individual checkin pages (one per checkin) | `toasts` (count + users), `comment_count`                                                    |


## Output

### `output/<username>_checkins.json`

The main output file — fully enriched, sorted newest-first (some values left blank for privacy reasons):

```json
{
  "meta": {
    "user": "...",
    "total_checkins": 1337,
    "scraped_at": "2026-02-28T19:00:00.000Z",
    "oldest_checkin": "2013-07-12T18:00:00.000Z",
    "newest_checkin": "2026-02-27T16:19:10.000Z"
  },
  "checkins": [
    {
      "checkin_id": 1311912126,
      "checkin_url": "https://untappd.com/user/sjaakbanaan/checkin/1311912126",
      "created_at": "2023-09-08T15:19:55.000Z",
      "beer": {
        "name": "Whale Shark V5",
        "url": "https://untappd.com/b/de-kromme-haring-whale-shark-v5/5477759",
        "label_url": "https://assets.untappd.com/site/beer_logos/beer-5477759_959a1_sm.jpeg",
        "global_rating": 3.90078,
        "global_rating_count": 903,
        "abv": 8,
        "ibu": null,
        "style": "IPA - Imperial / Double New England / Hazy",
        "description": "With Whale Shark we explore the creamy depths of the New England Double IPA. The que Show More",
        "total_checkins": 992,
        "unique_users": 950,
        "monthly_checkins": null
      },
      "brewery": {
        "name": "De Kromme Haring - Utrecht, Utrecht - Untappd",
        "url": "https://untappd.com/DeKrommeHaring",
        "address": "Utrecht, Netherlands",
        "lat": 52.0197639,
        "lng": 4.4322071
      },
      "venue": {
        "name": "Stadhuisplein",
        "url": "https://untappd.com/v/stadhuisplein/3167552",
        "address": "Korte minrebroederstraat 3 Utrecht, Utrecht",
        "lat": 52.0921097,
        "lng": 5.1202483
      },
      "purchased_at": {
        "name": "Locals Utrecht",
        "url": "https://untappd.com/v/locals-utrecht/11580999",
        "address": "Vismarkt 2 Utrecht, Utrecht",
        "lat": 52.0913429,
        "lng": 5.1201501
      },
      "rating": 4,
      "serving_type": "Can",
      "comment": null,
      "photo_url": null,
      "toasts": {
        "count": 2,
        "users": [
          "...",
          "..."
        ]
      },
      "comment_count": 0,
      "tagged_friends": [],
      "badges": [],
      "flavor": null
    }
  ]
}
```

### `output/db/` — entity cache

Each entity is stored as a separate JSON file, keyed by its Untappd ID or slug:

| Directory                  | Key                | Contains                                                           |
| -------------------------- | ------------------ | ------------------------------------------------------------------ |
| `db/beers/<id>.json`       | numeric beer ID    | `beer_url`, rating, ABV, IBU, style, description, stats            |
| `db/locations/<id>.json`   | numeric venue ID   | `venue_url`, address, lat/lng                                      |
| `db/breweries/<slug>.json` | URL-derived slug   | `brewery_url`, address, lat/lng (resolved via embedded venue page) |
| `db/checkins/<id>.json`    | numeric checkin ID | `flavor` array (only written with `--include-flavors`)             |

Storing the permalink in each file means live stats (`global_rating`, `global_rating_count`, `total_checkins`, `unique_users`, `monthly_checkins`) can be refreshed with `npm run scrape:stats`.

## Notes

- **Concurrency**: defaults to 4 parallel workers (set `CONCURRENCY` in `lib/config.mjs`). Raise to 6–8 for faster runs; lower if you see errors
- **Rate limiting**: 1 s delay per worker between requests
- **Cookie expiry**: if you see a "Session expired" error, grab a fresh cookie from your browser
- **Flavor profiles**: opt-in via `--include-flavors`; results are cached in `output/db/checkins/` so only new checkins need fetching on subsequent runs
- **scrape:stats**: opt-in via `--stats`; re-scrapes beer stats and checkin activity (toasts, comments) for every entry in the existing output file without touching the rest of your data
- **Mapbox Key**: if no `MAPBOX_KEY` is provided, the scraper will still run, but it won't be able to enrich location data (reverse-geocoding for clean names or forward-geocoding for missing coordinates). Resulting JSON will rely on raw Untappd data.
