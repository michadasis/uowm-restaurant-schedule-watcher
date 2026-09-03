// Port of watch_and_update.py.
// Checks the UoWM restaurant-schedule page for a new/changed menu PDF.
// If the PDF differs from the one already recorded in menu_meta.source_pdf_url,
// downloads it, runs it through the parse/translate pipeline, and applies the
// resulting SQL straight to the database.
//
// Requires POSTGRES_URL (or POSTGRES_URL_NON_POOLING) in the environment.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import pg from "pg";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractPageGeometry } from "./pdf/extract.js";
import { parseWeekFromPage, buildSql } from "./utils.js";
import { translateWeeks } from "./translate.js";
import { BREAKFAST_GR, BREAKFAST_EN } from "./constants.js";

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

async function getStoredPdfUrl(client) {
  const regclass = await client.query("SELECT to_regclass('public.menu_meta') AS reg");
  if (regclass.rows[0].reg === null) return null;
  const result = await client.query("SELECT source_pdf_url FROM menu_meta WHERE id = 1");
  return result.rows.length ? result.rows[0].source_pdf_url : null;
}

export async function runWatch() {
  const dbUrl = process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
  if (!dbUrl) {
    throw new Error("Set POSTGRES_URL (or POSTGRES_URL_NON_POOLING) in the environment.");
  }

  const pdfUrl = await findPdfUrl(PAGE_URL);

  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  try {
    const storedUrl = await getStoredPdfUrl(client);
    if (storedUrl === pdfUrl) {
      return "No change since last run.";
    }

    const resp = await fetch(pdfUrl);
    if (!resp.ok) throw new Error(`Failed to download PDF: ${resp.status}`);
    const pdfBuffer = Buffer.from(await resp.arrayBuffer());

    const tmpPath = path.join(os.tmpdir(), `uowm-menu-${Date.now()}-${crypto.randomUUID()}.pdf`);
    fs.writeFileSync(tmpPath, pdfBuffer);
    try {
      const data = new Uint8Array(pdfBuffer);
      const doc = await getDocument({ data, disableFontFace: true, isEvalSupported: false }).promise;

      const weeksGr = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const { rects, chars } = await extractPageGeometry(page);
        weeksGr.push(parseWeekFromPage(rects, chars));
      }

      const weeksEn = await translateWeeks(weeksGr);
      const sqlContent = buildSql(weeksGr, weeksEn, weeksGr.length, pdfUrl, BREAKFAST_GR, BREAKFAST_EN);

      await client.query(sqlContent);
      return `Database updated successfully. New PDF: ${pdfUrl}`;
    } finally {
      fs.unlinkSync(tmpPath);
    }
  } finally {
    await client.end();
  }
}
