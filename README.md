# Untappd Scraper XL v0.9.6

Scrape **all** your Untappd checkins into a rich, structured JSON file, so you can import it into tools like [Untappd Data Visualised](https://github.com/sjaakbanaan/untappd-data-visualised).

You do **not** need to be a programmer. You will install one free program (Node.js), copy a few files, paste your Untappd username, and run a couple of commands. The rest is automated.

> **Already familiar with working with npm?** Skip the hand-holding. Clone the repo, then jump to [step 4](#4-install-the-project-libraries) (`npm install`, `.env`, cookie, scrape).

## What this does (in plain language)

- **Scraping** means a script opens your Untappd profile (using a login cookie from your browser) and copies every checkin into a file on your computer.
- **Node.js** is the program that runs that script. It includes `npm`, which downloads the extra libraries this project needs.
- **JSON** is a text file format that other apps can import. After a successful run you will have something like `output/yourname_checkins.json`.

A first full scrape can take a while (roughly 25 minutes per 1000 checkins). You can stop anytime with `Ctrl+C`; progress is saved and you can continue later.

---

## 1. What you need

- A computer (macOS, Windows, or Linux)
- An Untappd account, and a browser where you are **logged in** at [untappd.com](https://untappd.com)
- About 10 minutes for setup, plus scrape time
- [Node.js **22 or newer](https://nodejs.org/)** (the current **LTS** download is fine)

Check whether Node is already installed: open a terminal (see [step 3](#3-open-a-terminal-in-this-folder)) and type:

```bash
node -v
```

You should see something like `v22.14.0` or `v24.4.0`. If the number is **22 or higher**, skip to [step 2](#2-get-this-project-on-your-computer). If you get an error, or a version below 22, install Node first.

### Install Node.js

1. Go to [https://nodejs.org](https://nodejs.org)
2. Download the **LTS** installer for your operating system
3. Run the installer and accept the defaults (this also installs `npm`)
4. **Close and reopen** your terminal, then run `node -v` again to confirm

On macOS, Homebrew users can instead run `brew install node`.

---

## 2. Get this project on your computer

Pick one:

**Option A — Download a ZIP (easiest)**

1. Open this repo on GitHub
2. Click the green **Code** button → **Download ZIP**
3. Unzip the file somewhere easy to find, for example your Desktop
4. You should now have a folder named something like `untappd-scraper-xl`

**Option B — Clone with Git** (if you already use Git)

```bash
git clone https://github.com/sjaakbanaan/untappd-scraper-xl.git
cd untappd-scraper-xl
```

---

## 3. Open a terminal in this folder

A **terminal** is a text window where you type commands. You must run commands **from inside** the project folder, not from your home folder.

**macOS**

1. Open **Terminal** (Spotlight: press `Cmd+Space`, type `Terminal`, press Enter)
2. Type `cd`  (with a space after `cd`), then drag the unzipped project folder onto the Terminal window. That pastes the path. Press Enter.

**Windows**

1. Open **File Explorer** and go into the unzipped project folder
2. Click the address bar, type `powershell`, press Enter
  Or: in the folder, hold `Shift` and right-click → **Open PowerShell window here** / **Open in Terminal**

On Windows PowerShell, `ls` also works. You should see files such as `package.json`, `README.md`, and `.env.example`. If not, you are in the wrong folder.

---

## 4. Install the project libraries

Still in the project folder, run:

```bash
npm install
```

This reads `package.json` and downloads helpers into a `node_modules` folder. You only need to do this once (or again after you update the project). It can take a minute. When it finishes without a red error, continue.

---

## 5. Create your settings file

The project ships with a **template** named `.env.example`. You need a private copy named `.env` (the leading dot is normal; it is a hidden file).

**macOS / Linux:**

```bash
cp .env.example .env
```

**Windows (PowerShell or Command Prompt):**

```bash
copy .env.example .env
```

Open `.env` in any text editor (Notepad, TextEdit, Cursor, VS Code). If you cannot see it:

- **macOS Finder:** press `Cmd+Shift+.` to show hidden files
- **Windows Explorer:** View → Show → Hidden items
- **Cursor / VS Code:** the file is listed in the sidebar even when Finder hides it

Fill in at least your username. Leave the cookie line for the next step, or paste a cookie if you already have one.

```
UNTAPPD_COOKIE="your_cookie_string_here"
UNTAPPD_USER="your_untappd_username"
MAPBOX_KEY=""
```


| Variable         | Required? | What to put there                                                                                                            |
| ---------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `UNTAPPD_USER`   | Yes       | Your Untappd username, exactly as in `https://untappd.com/user/yourname`                                                     |
| `UNTAPPD_COOKIE` | Yes       | Session cookie from a browser where **that same user** is logged in (next step)                                              |
| `MAPBOX_KEY`     | No        | [Mapbox access token](https://account.mapbox.com/) for nicer location names/coordinates. Leave empty if you do not have one. |


Do **not** share `.env` or commit it to Git. The cookie is equivalent to being logged in as you.

---

## 6. Get your Untappd cookie

The scraper cannot log in with a password. It reuses the session cookie your browser already has after you log in at [untappd.com](https://untappd.com). Log in there **before** this step.

### Option A — Copy the cookie from your browser

This is the reliable method. It works in any browser.

Video walkthrough:

https://github.com/user-attachments/assets/46701bff-762f-408a-9e40-439aa769cc54

1. Log into [untappd.com](https://untappd.com)
2. Open DevTools (`F12`, or `Cmd+Option+I` on Mac)
3. Open the **Network** tab and reload the page
4. Click the **Doc** filter, then click the request whose name starts with `stats?id=`
5. Under **Request Headers**, copy the full `Cookie:` value
6. Paste it into `.env` as `UNTAPPD_COOKIE="…"` (keep the quotes)

Then go to [step 7](#7-run-your-first-scrape).

The cookie expires. If a later scrape says the session expired, or keeps printing `Empty page, retrying…`, log into Untappd in your browser again and repeat these steps (or re-run `npm run cookie`).

### Option B — Let the script copy it

A shortcut if you would rather not use DevTools. It can fail depending on your browser and OS; if it does, use option A.

In the project terminal:

```bash
npm run cookie
```

If it works, you will see that it found cookies and updated `.env`. Then skip to [step 7](#7-run-your-first-scrape).

If it fails, try:

```bash
npm run cookie -- --browser firefox
```

or, if you use a named Chrome profile:

```bash
npm run cookie -- --browser chrome --profile "Profile 1"
```

Other useful flags:

```bash
npm run --silent cookie -- --print
npm run cookie -- --dry-run
```

`--print` only prints the cookie (does not write `.env`). `--dry-run` searches but does not save.

**Notes on the helper**

- Needs Node.js 22+ (built-in SQLite)
- Firefox is usually the most reliable, because its cookies are stored in a readable database
- Chrome, Edge, Brave, Chromium, and Arc encrypt cookies. The helper supports common macOS, Linux, and Windows setups. Newer Windows Chrome-family profiles may block export (App-Bound Encryption). In that case use Firefox or option A.

---

## 7. Run your first scrape

```bash
npm run scrape:full
```

This walks your **entire** Untappd feed from newest to oldest, then fetches beer, venue, and brewery details. The result is `output/<username>_checkins.json`.

You can stop with `Ctrl+C`. Run the same command again to continue from where you left off.

When it finishes, look in the `output` folder next to the rest of the project files.

---

## 8. Keep the file up to date

After the first full scrape, you do **not** need to download everything again. After a drinking session:

```bash
npm run scrape
```

That starts at the top of your feed and **stops at the first checkin already in your file**. New checkins are merged in. If there is no output file yet, this command automatically does a full scrape instead.

---

## All commands


| Script                 | Flag        | What it does                                                                                         |
| ---------------------- | ----------- | ---------------------------------------------------------------------------------------------------- |
| `npm run cookie`       | *(none)*    | Fetch the current Untappd cookie from your browser and write it to `.env`                            |
| `npm run scrape`       | *(default)* | **Incremental** — fetch only new checkins, stop at the first known one, merge into the existing file |
| `npm run scrape:full`  | `--full`    | **Full scrape** — paginate the entire feed newest → oldest                                           |
| `npm run scrape:stats` | `--stats`   | **Stats refresh** — re-scrape live beer stats, toasts, and comments for every existing checkin       |


```bash
# Optional: also scrape per-checkin flavor profiles (scrape and scrape:full only)
npm run scrape -- --include-flavors
npm run scrape:full -- --include-flavors
```

### Incremental mode (`npm run scrape`)

Loads the existing output file, scrapes from the top, and stops at the first known checkin ID. On the very first run (no output file yet) it silently falls back to a full scrape.

### Full scrape (`npm run scrape:full`)

Paginates the entire feed in batches, running phases 2–3 (and optionally 4) after every flush:

1. **Phase 1 — Checkin feed**: Paginates until the feed is exhausted.
2. **Phase 2 — Beer details**: Fetches each unique beer page not yet in `output/db/beers/`.
3. **Phase 3 — Venue & brewery details**: Fetches venue/brewery pages not yet cached in `output/db/locations/` and `output/db/breweries/`.
4. **Phase 4 — Flavor profiles** *(opt-in,* `--include-flavors`*)*: Fetches individual checkin pages for flavor tags; cached in `output/db/checkins/`.



### Stats refresh (`npm run scrape:stats`)

Loads the existing output file and re-scrapes only the fields that change over time, without touching the rest of your data:


| Sub-phase                | Pages fetched                              | Fields refreshed                                                                             |
| ------------------------ | ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| **A — Beer stats**       | Beer pages (unique per beer)               | `global_rating`, `global_rating_count`, `total_checkins`, `unique_users`, `monthly_checkins` |
| **B — Checkin activity** | Individual checkin pages (one per checkin) | `toasts` (count + users), `comment_count`                                                    |


---

## Troubleshooting


| What you see                                            | What it usually means                                                     | What to do                                                                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `node: command not found` or `'node' is not recognized` | Node.js is not installed, or the terminal was opened before installing it | Install Node from [nodejs.org](https://nodejs.org), then **close and reopen** the terminal             |
| `npm: command not found`                                | Same as above; `npm` ships with Node                                      | Reinstall Node LTS and reopen the terminal                                                             |
| `ENOENT` / `package.json` not found                     | You are not in the project folder                                         | `cd` into the unzipped `untappd-scraper-xl` folder and try again                                       |
| `Set UNTAPPD_COOKIE in your .env file first`            | `.env` is missing, or the cookie line is still the placeholder            | Create `.env` from `.env.example` and complete [step 6](#6-get-your-untappd-cookie)                    |
| `No Untappd cookies found`                              | You are not logged in, or the helper cannot read that browser             | Log into untappd.com, then copy the cookie from DevTools (option A). Or retry with `--browser firefox` |
| `Session expired`                                       | The cookie went stale                                                     | Log into Untappd in your browser, then paste a fresh cookie (or re-run `npm run cookie`)               |
| `Empty page, retrying…`                                 | The cookie is stale or incomplete, so later feed pages come back empty    | Log into Untappd in your browser, then repeat [step 6](#6-get-your-untappd-cookie)                     |
| Lots of failed requests / throttling                    | Too many parallel requests                                                | Leave it as-is first; if it keeps failing, lower `CONCURRENCY` in `lib/config.mjs` (see Notes)         |
| Cookie helper errors about SQLite                       | Node is too old                                                           | Upgrade to Node.js 22 or newer                                                                         |

---

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

---

## Notes

- **Concurrency**: defaults to 4 parallel workers (set `CONCURRENCY` in `lib/config.mjs`). Raise to 6–8 for faster runs; lower if you see errors
- **Rate limiting**: 1 s delay per worker between requests
- **Cookie expiry**: if you see a "Session expired" error, or `Empty page, retrying…`, grab a fresh cookie from your browser (repeat [step 6](#6-get-your-untappd-cookie))
- **Flavor profiles**: opt-in via `--include-flavors`; results are cached in `output/db/checkins/` so only new checkins need fetching on subsequent runs
- **scrape:stats**: opt-in via `--stats`; re-scrapes beer stats and checkin activity (toasts, comments) for every entry in the existing output file without touching the rest of your data
- **Mapbox key**: if no `MAPBOX_KEY` is provided, the scraper will still run, but it will not enrich location data (reverse-geocoding for clean names or forward-geocoding for missing coordinates). The JSON will use raw Untappd data instead

