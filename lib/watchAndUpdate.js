// Port of watch_and_update.py.
// Checks the UoWM restaurant-schedule page for a new/changed menu PDF.
// If the PDF differs from the one already recorded in menu_meta.source_pdf_url,
// downloads it, runs it through the parse/translate pipeline, and applies the
// resulting SQL straight to the database.
//
// Requires POSTGRES_URL (or POSTGRES_URL_NON_POOLING) in the environment.
import pg from "pg";
import { convertPdfBytesToSql } from "./main.js";
import { ENSURE_SCHEMA_SQL } from "./utils.js";

const { Client } = pg;

export const PAGE_URL =
  "https://www.uowm.gr/epikairotita/sitisi/enimerosi-gia-tin-leitoyrgia-ton-estiatorion-toy-panepistimioy-dytikis-makedonias-2024/";

export async function findPdfUrl(pageUrl) {
  const resp = await fetch(pageUrl);
  if (!resp.ok) throw new Error(`Failed to fetch page: ${resp.status}`);
  const html = await resp.text();
  const match = html.match(/href="([^"]+\.pdf)"/i);
  if (!match) throw new Error("No PDF link found on the page.");
  let url = match[1];
  if (url.startsWith("/")) url = "https://www.uowm.gr" + url;
  return url;
}

async function downloadPdf(pdfUrl) {
  const resp = await fetch(pdfUrl);
  if (!resp.ok) throw new Error(`Failed to download PDF: ${resp.status}`);
  return new Uint8Array(await resp.arrayBuffer());
}

// node-postgres now treats sslmode=require/prefer/verify-ca in a connection
// string as aliases for full certificate verification. Supabase's pooler
// serves a cert chain Node's default trust store doesn't recognize, so a
// plain `sslmode=require` URL fails to connect at all ("self-signed
// certificate in certificate chain"). This opts back into libpq's classic
// "require" semantics (encrypt, don't verify the chain) — see the warning
// pg itself prints, and https://node-postgres.com/announcements.
function withLibpqSslCompat(connectionString) {
  const url = new URL(connectionString);
  url.searchParams.set("uselibpqcompat", "true");
  return url.toString();
}

async function getStoredPdfUrl(client) {
  const regclass = await client.query("SELECT to_regclass('public.menu_meta') AS reg");
  if (regclass.rows[0].reg === null) return null;
  const result = await client.query("SELECT source_pdf_url FROM menu_meta WHERE id = 1");
  return result.rows.length ? result.rows[0].source_pdf_url : null;
}

/**
 * Generates the SQL for whatever PDF is currently linked on the UoWM page,
 * without touching the database. Used for manual review/preview.
 */
export async function generateSqlPreview() {
  const pdfUrl = await findPdfUrl(PAGE_URL);
  const data = await downloadPdf(pdfUrl);
  const sql = await convertPdfBytesToSql(data, pdfUrl);
  return { pdfUrl, sql };
}

export async function runWatch() {
  const dbUrl = process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
  if (!dbUrl) {
    throw new Error("Set POSTGRES_URL (or POSTGRES_URL_NON_POOLING) in the environment.");
  }

  const pdfUrl = await findPdfUrl(PAGE_URL);

  const client = new Client({ connectionString: withLibpqSslCompat(dbUrl) });
  await client.connect();
  try {
    await client.query(ENSURE_SCHEMA_SQL);

    const storedUrl = await getStoredPdfUrl(client);
    if (storedUrl === pdfUrl) {
      return "No change since last run.";
    }

    const data = await downloadPdf(pdfUrl);
    const sqlContent = await convertPdfBytesToSql(data, pdfUrl);

    await client.query(sqlContent);
    return `Database updated successfully. New PDF: ${pdfUrl}`;
  } finally {
    await client.end();
  }
}
