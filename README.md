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

```bash
npm run scrape
```

Every run scrapes the **complete** feed from scratch (newest → oldest) and writes `output/<username>_checkins.json`. Previously cached entity data (beers, venues, breweries) is reused automatically, so only truly new entities need to be fetched — making subsequent runs much faster.

### What happens during a run

1. **Phase 1 — Checkin feed**: Paginates through your full Untappd profile, collecting every checkin until the feed is exhausted.
2. **Phase 2 — Beer details**: Fetches the beer page for each unique beer not yet in the local cache (`output/db/beers/`).
3. **Phase 3 — Venue & brewery details**: Fetches venue and brewery pages for any not yet cached (`output/db/locations/`, `output/db/breweries/`).

Progress is flushed to disk in batches, so a crash mid-run won't lose already-scraped data.

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
        "lat": null,
        "lng": null
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
      "toasts": { "count": 0, "users": [] },
      "comment_count": 0,
      "tagged_friends": ["Teuntjetripel"],
      "badges": []
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
| `db/breweries/<slug>.json` | URL-derived slug | `brewery_url`, address, lat/lng |

Storing the permalink in each file means live stats (`global_rating`, `global_rating_count`, `total_checkins`, `unique_users`, `monthly_checkins`) can be refreshed in the future without re-scraping the entire feed.

## Notes

- **Rate limiting**: 1.2 s delay between requests (set via `DELAY_MS` in `lib/config.mjs`)
- **Cookie expiry**: if you see a "Session expired" error, grab a fresh cookie from your browser
- **Incremental mode**: a `--incremental` flag is planned — it will stop at the first already-seen checkin (new ones always appear at the top of the feed)
