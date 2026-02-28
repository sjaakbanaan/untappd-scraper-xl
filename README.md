# Untappd Scraper XL

Scrape **all** your Untappd checkins into a rich, structured JSON file.  
No Chromium/Puppeteer needed — just `fetch` + `cheerio` + your session cookie.

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env` and fill in your Untappd credentials:

| Variable | Description |
|---|---|
| `UNTAPPD_COOKIE` | Your session cookie (see below) |
| `UNTAPPD_USER` | Your Untappd username |

### Getting your session cookie

1. Log into [untappd.com](https://untappd.com) in your browser
2. Open DevTools → **Network** tab
3. Reload the page
4. Click any request to `untappd.com`
5. Under **Request Headers**, copy the full `Cookie:` value
6. Paste it into `.env` as `UNTAPPD_COOKIE="…"`

## Usage

### First time

```bash
npm run scrape:full
```

This paginates your **entire** Untappd feed from newest to oldest, fetches beer/venue/brewery details, and writes `output/<username>_checkins.json`. Depending on your history this can take a while — it only needs to be done once.

### Keeping up to date

```bash
npm run scrape
```

Scrapes the feed from the top and **stops as soon as it hits a checkin already in your output file**. New checkins are merged in automatically. Run this after every drinking session.

### All commands

| Script | Flag | What it does |
|---|---|---|
| `npm run scrape` | *(default)* | **Incremental** — fetch only new checkins, stop at first known one, merge into existing output |
| `npm run scrape:full` | `--full` | **Full scrape** — paginate the entire feed newest → oldest |
| `npm run scrape:stats` | `--stats` | **Stats refresh** — re-scrape live beer stats, toasts & comments for every existing checkin |

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

| Sub-phase | Pages fetched | Fields refreshed |
|---|---|---|
| **A — Beer stats** | Beer pages (unique per beer) | `global_rating`, `global_rating_count`, `total_checkins`, `unique_users`, `monthly_checkins` |
| **B — Checkin activity** | Individual checkin pages (one per checkin) | `toasts` (count + users), `comment_count` |


## Output

### `output/<username>_checkins.json`

The main output file — fully enriched, sorted newest-first:

```json
{
  "meta": {
    "user": "sjaakbanaan",
    "total_checkins": 7231,
    "scraped_at": "2026-02-28T19:00:00.000Z",
    "oldest_checkin": "2013-07-12T18:00:00.000Z",
    "newest_checkin": "2026-02-27T16:19:10.000Z"
  },
  "checkins": [
    {
      "checkin_id": 1552073115,
      "checkin_url": "https://untappd.com/user/sjaakbanaan/checkin/1552073115",
      "created_at": "2026-02-27T16:19:10.000Z",
      "beer": {
        "name": "Barbarian Fishing Superdelic Columbus",
        "url": "https://untappd.com/b/de-kromme-haring-…/6599834",
        "label_url": "https://assets.untappd.com/…",
        "beer_url": "https://untappd.com/b/de-kromme-haring-…/6599834",
        "global_rating": 3.84,
        "global_rating_count": 56,
        "abv": 8,
        "ibu": null,
        "style": "IPA - Imperial / Double New England / Hazy",
        "description": "…",
        "total_checkins": 61,
        "unique_users": 61,
        "monthly_checkins": 61
      },
      "brewery": {
        "name": "De Kromme Haring",
        "url": "https://untappd.com/DeKrommeHaring",
        "brewery_url": "https://untappd.com/DeKrommeHaring",
        "address": "Utrecht, Netherlands",
        "lat": 52.0197639,
        "lng": 4.4322071
      },
      "venue": {
        "name": "Eagerly Internet",
        "url": "https://untappd.com/v/eagerly-internet/8632005",
        "venue_url": "https://untappd.com/v/eagerly-internet/8632005",
        "address": "Jansveld 31 Utrecht, Utrecht",
        "lat": 52.0945587,
        "lng": 5.1205621
      },
      "purchased_at": { "…": "same shape as venue" },
      "rating": 3.9,
      "serving_type": "Can",
      "comment": null,
      "photo_url": "https://images.untp.beer/…",
      "toasts": { "count": 1, "users": ["cbeijer"] },
      "comment_count": 0,
      "tagged_friends": ["Teuntjetripel"],
      "badges": [],
      "flavor": ["Hoppy", "Grapefruity", "Grapefruit Peel"]
    }
  ]
}
```

### `output/db/` — entity cache

Each entity is stored as a separate JSON file, keyed by its Untappd ID or slug:

| Directory | Key | Contains |
|---|---|---|
| `db/beers/<id>.json` | numeric beer ID | `beer_url`, rating, ABV, IBU, style, description, stats |
| `db/locations/<id>.json` | numeric venue ID | `venue_url`, address, lat/lng |
| `db/breweries/<slug>.json` | URL-derived slug | `brewery_url`, address, lat/lng (resolved via embedded venue page) |
| `db/checkins/<id>.json` | numeric checkin ID | `flavor` array (only written with `--include-flavors`) |

Storing the permalink in each file means live stats (`global_rating`, `global_rating_count`, `total_checkins`, `unique_users`, `monthly_checkins`) can be refreshed in the future without re-scraping the entire feed.

## Notes

- **Concurrency**: defaults to 4 parallel workers (set `CONCURRENCY` in `lib/config.mjs`). Raise to 6–8 for faster runs; lower if you see errors
- **Rate limiting**: 1 s delay per worker between requests
- **Cookie expiry**: if you see a "Session expired" error, grab a fresh cookie from your browser
- **Flavor profiles**: opt-in via `--include-flavors`; results are cached in `output/db/checkins/` so only new checkins need fetching on subsequent runs
- **scrape:stats**: opt-in via `--stats`; re-scrapes beer stats and checkin activity (toasts, comments) for every entry in the existing output file without touching the rest of your data
