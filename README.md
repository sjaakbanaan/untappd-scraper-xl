# Untappd Scraper XL

Scrape **all** your Untappd checkins into a structured JSON file.  
No Chromium/Puppeteer needed — just `fetch` + `cheerio` + your session cookie.

## Setup

```bash
npm install
cp .env.example .env
```

Then edit `.env` and paste your Untappd session cookie:

1. Log into [untappd.com](https://untappd.com) in your browser
2. Open DevTools → **Network** tab
3. Reload the page
4. Click any request to `untappd.com`
5. In **Request Headers**, copy the full `Cookie:` value
6. Paste it into `.env` as `UNTAPPD_COOKIE="…"`

## Run

```bash
npm run scrape
```

The scraper will:
- Fetch the initial profile page, then paginate through `more_feed`
- Parse each checkin's beer, brewery, venue, rating, date, photo, etc.
- Save progress every 25 pages (resume-safe if interrupted)
- Output to `output/<username>_checkins.json`

### Flags
- `--fresh`: Start a clean scrape (deletes progress and beer cache).
- `--limit [number]`: Stop after scraping [number] checkins (useful for testing Phase 2).

**Note**: When using `npm run`, you must use a double dash `--` to pass arguments to the script:
```bash
npm run scrape:fresh -- --limit 50
```

## Output format

```json
{
  "meta": {
    "user": "sjaakbanaan",
    "total_checkins": 7231,
    "scraped_at": "2026-02-27T22:30:00.000Z",
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
        "url": "https://untappd.com/b/de-kromme-haring-barbarian-fishing-superdelic-columbus/6599834",
        "label_url": "https://…"
      },
      "brewery": {
        "name": "De Kromme Haring",
        "url": "https://untappd.com/DeKrommeHaring"
      },
      "venue": {
        "name": "Eagerly Internet",
        "url": "https://untappd.com/v/eagerly-internet/8632005"
      },
      "purchased_at": {
        "name": "Daan's Drinks",
        "url": "https://untappd.com/v/daan-s-drinks/13098627"
      },
      "rating": 3.75,
      "serving_type": "Can",
      "comment": null,
      "photo_url": null
    }
  ]
}
```

## Notes

- **Rate limiting**: 1.2 s delay between requests (configurable via `DELAY_MS` in script)
- **Resume**: if interrupted, re-run and it picks up from the saved progress file
- **Cookie expiry**: if you get a session-expired error, grab a fresh cookie from your browser
