# UoWM PDF Menu to SQL

Reads the UoWM restaurant menu PDF and converts it into SQL that sets up and populates a PostgreSQL database, either as a one-off file (manual run) or pushed straight to the database (automated watcher).

The PDF format it expects is the UoWM's restaurant schedule, where each page is one week and each week has a lunch and dinner section laid out as a table with the days of the week as columns. The number of weeks in the output is determined by the number of pages in the PDF, so if the schedule changes from a 2 week cycle to a 4 week cycle next year, you just run it again with the new PDF and it handles it automatically. It also automatically translates every meal from Greek to English so it's possible to have a bilingual page layout.

## Requirements

Node.js 20+.

```bash
npm install
```

## Manual usage

```bash
node lib/main.js <input.pdf> [output.sql] [source_pdf_url]
```

The second argument is optional. If you leave it out, the output goes to `restaurantMenu.sql` in the current directory. The third argument (optional) is recorded in `menu_meta.source_pdf_url`.

Example:

```bash
node lib/main.js MENU-2025-2026.pdf restaurantMenu.sql
```

The generated file creates three tables (`menu_meta`, `breakfast_items`, `menu_items`) if they don't already exist, truncates them, and inserts the parsed menu. Apply it to your database with, for example:

```bash
psql -U <user> -d <database> -f restaurantMenu.sql
```

## Automated watcher

`lib/watchAndUpdate.js` checks the UoWM restaurant-schedule page for a new/changed menu PDF, and if it differs from the URL already recorded in `menu_meta.source_pdf_url`, downloads it, parses and translates it, and applies the resulting SQL directly to Postgres. Requires `POSTGRES_URL` (or `POSTGRES_URL_NON_POOLING`) in the environment.

`api/watch.js` + `vercel.json` wire this up as a Vercel Cron Job. Set `POSTGRES_URL` (and optionally `CRON_SECRET`, which Vercel sets automatically as a request header when configured) as environment variables on the Vercel project.

## Manual SQL preview (no database write)

`api/generate-sql.js` fetches whatever PDF is currently linked on the UoWM page, parses and translates it, and returns the generated SQL as plain text — it never touches the database. Useful for reviewing the SQL yourself before deciding whether to apply it.

```
https://<your-deployment>.vercel.app/api/generate-sql?key=<CRON_SECRET>
```

Open that in a browser (or `curl` it) to get the SQL back as a downloadable text response. It's gated by the same `CRON_SECRET` as the cron job — accepted either as `?key=` or as an `Authorization: Bearer <CRON_SECRET>` header.

## Project structure

- `lib/pdf/` — a from-scratch PDF table/text extraction layer built on `pdfjs-dist`, ported line-for-line from [pdfplumber](https://github.com/jsvine/pdfplumber)'s table-detection algorithm (which the project originally relied on via Python), since this document's tables are reconstructed from the PDF's drawn grid rectangles rather than plain text layout.
- `lib/utils.js` — menu parsing (day/column detection, SQL generation).
- `lib/translate.js` — Greek→English translation via Google Translate's `translate.google.com/m` endpoint.
- `lib/main.js` — CLI entry point and the shared parse/translate/build-SQL pipeline.
- `lib/watchAndUpdate.js` — PDF-on-page discovery, plus the DB-writing watcher and the DB-free preview generator.
- `api/watch.js` — Vercel Cron entry point (writes to the database).
- `api/generate-sql.js` — manual preview endpoint (does not write to the database).
