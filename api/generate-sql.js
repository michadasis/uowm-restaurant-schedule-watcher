// Manual-trigger endpoint: fetches whatever menu PDF is currently linked on
// the UoWM page, parses/translates it, and returns the generated SQL as
// plain text for you to review and apply yourself. Does NOT touch the
// database (unlike /api/watch, which is what the cron job calls).
//
// Protected by the same CRON_SECRET used for the cron job — open
// https://<your-deployment>/api/generate-sql?key=<CRON_SECRET> in a browser,
// or omit the key check by leaving CRON_SECRET unset (not recommended once
// this is deployed, since anyone could hit it and burn function time).
import { generateSqlPreview } from "../lib/watchAndUpdate.js";

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  const providedKey = req.headers.authorization === `Bearer ${cronSecret}` || req.query.key === cronSecret;
  if (cronSecret && !providedKey) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    const { pdfUrl, sql } = await generateSqlPreview();
    const header = `-- Source PDF: ${pdfUrl}\n-- Generated: ${new Date().toISOString()}\n-- This SQL was NOT applied to any database. Review before running it.\n\n`;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.status(200).send(header + sql);
  } catch (err) {
    res.status(500).send(String(err && err.message ? err.message : err));
  }
}
