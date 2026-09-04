// Port of watch_and_update.py.
// Checks the UoWM restaurant-schedule page for a new/changed menu PDF.
// If the PDF differs from the one already recorded in menu_meta (by URL or
// content hash), downloads it, runs it through the parse/translate
// pipeline, and applies the resulting SQL straight to the database.
//
// Requires POSTGRES_URL (or POSTGRES_URL_NON_POOLING) in the environment.
import crypto from "node:crypto";
import pg from "pg";
import { convertPdfBytesToSql, parsePdfBytes } from "./main.js";
import { translateWeeks } from "./translate.js";
import { ENSURE_SCHEMA_SQL, flattenBreakfastRows, flattenMenuItemRows } from "./utils.js";
import { BREAKFAST_GR, BREAKFAST_EN } from "./constants.js";

const { Client } = pg;

export const PAGE_URL =
  "https://www.uowm.gr/epikairotita/sitisi/enimerosi-gia-tin-leitoyrgia-ton-estiatorion-toy-panepistimioy-dytikis-makedonias-2024/";

const FETCH_TIMEOUT_MS = 30000;
const MAX_PDF_BYTES = 20 * 1024 * 1024; // real menu PDFs are ~200KB

// A real menu (a 2+ week cycle across 7 days, lunch and dinner) has well
// over a hundred rows. Anything under this points at a parse that silently
// came back empty rather than an unusually short menu.
const MIN_MENU_ITEMS = 20;

export async function findPdfUrl(pageUrl) {
  const resp = await fetch(pageUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!resp.ok) throw new Error(`Failed to fetch page: ${resp.status}`);
  const html = await resp.text();
  // Requires the wp-content/uploads path (where the university's media
  // actually lives) so this can't grab an unrelated PDF linked elsewhere on
  // the page. Accepts single or double quotes and a trailing query string.
  const match = html.match(/href=(["'])([^"']*wp-content\/uploads\/[^"']+\.pdf(?:\?[^"']*)?)\1/i);
  if (!match) throw new Error("No PDF link found on the page.");
  return new URL(match[2], pageUrl).href;
}

async function downloadPdf(pdfUrl) {
  const resp = await fetch(pdfUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!resp.ok) throw new Error(`Failed to download PDF: ${resp.status}`);
  const contentLength = Number(resp.headers.get("content-length"));
  if (contentLength && contentLength > MAX_PDF_BYTES) {
    throw new Error(`PDF too large (${contentLength} bytes, max ${MAX_PDF_BYTES}).`);
  }
  const buffer = await resp.arrayBuffer();
  if (buffer.byteLength > MAX_PDF_BYTES) {
    throw new Error(`PDF too large (${buffer.byteLength} bytes, max ${MAX_PDF_BYTES}).`);
  }
  return new Uint8Array(buffer);
}

function sha256Hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

// node-postgres now treats sslmode=require/prefer/verify-ca in a connection
// string as aliases for full certificate verification. Supabase's pooler
// serves a cert chain Node's default trust store doesn't recognize, so a
// plain `sslmode=require` URL fails to connect at all ("self-signed
// certificate in certificate chain"). This opts back into libpq's classic
// "require" semantics (encrypt, don't verify the chain). See the warning
// pg itself prints, and https://node-postgres.com/announcements.
function withLibpqSslCompat(connectionString) {
  const url = new URL(connectionString);
  url.searchParams.set("uselibpqcompat", "true");
  return url.toString();
}

function connectDb(dbUrl) {
  return new Client({ connectionString: withLibpqSslCompat(dbUrl) });
}

// menu_meta always exists by this point (ENSURE_SCHEMA_SQL runs first on
// this same connection), so there's no need to check for the table itself.
async function getStoredMenuState(client) {
  const result = await client.query("SELECT source_pdf_url, pdf_sha256 FROM menu_meta WHERE id = 1");
  if (!result.rows.length) return { url: null, hash: null };
  return { url: result.rows[0].source_pdf_url, hash: result.rows[0].pdf_sha256 };
}

function insertRowsSql(table, columns, rows) {
  const values = [];
  const placeholders = rows.map((row, i) => {
    const base = i * columns.length;
    values.push(...columns.map((c) => row[c]));
    return `(${columns.map((_, j) => `$${base + j + 1}`).join(", ")})`;
  });
  return { text: `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${placeholders.join(", ")}`, values };
}

async function writeMenuToDb(client, { weeksGr, weeksEn, cycleWeeks, pdfUrl, pdfHash }) {
  await client.query("BEGIN");
  try {
    await client.query(ENSURE_SCHEMA_SQL);
    await client.query("TRUNCATE TABLE menu_meta, breakfast_items, menu_items RESTART IDENTITY");
    await client.query(
      "INSERT INTO menu_meta (id, cycle_weeks, source_pdf_url, pdf_sha256) VALUES (1, $1, $2, $3)",
      [cycleWeeks, pdfUrl, pdfHash]
    );

    const breakfastRows = flattenBreakfastRows(BREAKFAST_GR, BREAKFAST_EN);
    if (breakfastRows.length) {
      const { text, values } = insertRowsSql("breakfast_items", ["category", "position", "item_gr", "item_en"], breakfastRows);
      await client.query(text, values);
    }

    const menuItemRows = flattenMenuItemRows(weeksGr, weeksEn);
    if (menuItemRows.length) {
      const { text, values } = insertRowsSql(
        "menu_items",
        ["week_num", "day_name", "meal_type", "course", "position", "item_gr", "item_en"],
        menuItemRows
      );
      await client.query(text, values);
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

/**
 * Generates the SQL for whatever PDF is currently linked on the UoWM page,
 * without touching the database. Used for manual review/preview.
 */
export async function generateSqlPreview() {
  const pdfUrl = await findPdfUrl(PAGE_URL);
  const data = await downloadPdf(pdfUrl);
  const { sql } = await convertPdfBytesToSql(data, pdfUrl);
  return { pdfUrl, sql };
}

export async function runWatch() {
  const dbUrl = process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
  if (!dbUrl) {
    throw new Error("Set POSTGRES_URL (or POSTGRES_URL_NON_POOLING) in the environment.");
  }

  const pdfUrl = await findPdfUrl(PAGE_URL);
  const data = await downloadPdf(pdfUrl);
  const pdfHash = sha256Hex(data);

  // Read-only connection, closed immediately after: the parse/translate
  // step below can take a while, and there's no reason to hold a Supabase
  // pooler connection idle for all of it.
  const readClient = connectDb(dbUrl);
  await readClient.connect();
  let stored;
  try {
    await readClient.query(ENSURE_SCHEMA_SQL);
    stored = await getStoredMenuState(readClient);
  } finally {
    await readClient.end();
  }

  // Compare both the URL and the content hash, so a same-URL re-upload
  // (the university fixing a typo and reposting under the same filename,
  // say) still gets picked up.
  if (stored.url === pdfUrl && stored.hash === pdfHash) {
    return "No change since last run.";
  }

  const weeksGr = await parsePdfBytes(data);
  const weeksEn = await translateWeeks(weeksGr);
  const menuItemRows = flattenMenuItemRows(weeksGr, weeksEn);

  if (menuItemRows.length < MIN_MENU_ITEMS) {
    throw new Error(
      `Refusing to write: parsed only ${menuItemRows.length} menu item(s), below the sanity threshold of ${MIN_MENU_ITEMS}. The PDF likely failed to parse.`
    );
  }

  const writeClient = connectDb(dbUrl);
  await writeClient.connect();
  try {
    await writeMenuToDb(writeClient, { weeksGr, weeksEn, cycleWeeks: weeksGr.length, pdfUrl, pdfHash });
  } finally {
    await writeClient.end();
  }

  return `Database updated successfully. New PDF: ${pdfUrl}`;
}
