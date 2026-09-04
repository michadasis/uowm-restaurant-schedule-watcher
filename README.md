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

`lib/watchAndUpdate.js` checks the UoWM restaurant-schedule page for a new menu PDF. If it differs from the URL recorded in `menu_meta.source_pdf_url`, it downloads it, parses and translates it, and applies the resulting SQL to Postgres. Requires `POSTGRES_URL` (or `POSTGRES_URL_NON_POOLING`) in the environment.

`api/watch.js` and `vercel.json` run this on a schedule via Vercel Cron. Set `POSTGRES_URL` and `CRON_SECRET` as environment variables on the Vercel project.

## Manual SQL preview

`api/generate-sql.js` fetches the current PDF, parses and translates it, and returns the generated SQL as plain text. It does not write to the database.

```
https://<your-deployment>.vercel.app/api/generate-sql?key=<CRON_SECRET>
```

Pass the key as `?key=` or as an `Authorization: Bearer <CRON_SECRET>` header.

## Project structure

- `lib/pdf/` — PDF table and text extraction, built on `pdfjs-dist`.
- `lib/utils.js` — menu parsing and SQL generation.
- `lib/translate.js` — Greek to English translation via Google Translate.
- `lib/main.js` — CLI entry point and the shared parse/translate/build-SQL pipeline.
- `lib/watchAndUpdate.js` — PDF discovery, the database-writing watcher, and the preview generator.
- `api/watch.js` — Vercel Cron entry point. Writes to the database.
- `api/generate-sql.js` — manual preview endpoint. Does not write to the database.
