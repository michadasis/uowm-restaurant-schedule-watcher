// Manual-trigger endpoint: fetches whatever menu PDF is currently linked on
// the UoWM page, parses/translates it, and returns the generated SQL as
// plain text for you to review and apply yourself. Does NOT touch the
// database (unlike /api/watch, which is what the cron job calls).
//
// Protected by the same CRON_SECRET used for the cron job. Open
// https://<your-deployment>/api/generate-sql?key=<CRON_SECRET> in a browser,
// or pass it as an Authorization: Bearer <CRON_SECRET> header.
import { generateSqlPreview } from "../lib/watchAndUpdate.js";
import { timingSafeStringEqual } from "../lib/auth.js";

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    res.status(500).send("Server misconfigured: CRON_SECRET is not set.");
    return;
  }
  const authHeader = req.headers.authorization || "";
  const queryKey = typeof req.query.key === "string" ? req.query.key : "";
  const authorized =
    timingSafeStringEqual(authHeader, `Bearer ${cronSecret}`) || timingSafeStringEqual(queryKey, cronSecret);
  if (!authorized) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    const { pdfUrl, sql } = await generateSqlPreview();
    const header = `-- Source PDF: ${pdfUrl}\n-- Generated: ${new Date().toISOString()}\n-- This SQL was NOT applied to any database. Review before running it.\n\n`;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.status(200).send(header + sql);
  } catch (err) {
    console.error(err);
    res.status(500).send("Internal error. Check server logs.");
  }
}
