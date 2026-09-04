// Vercel Cron entry point. Vercel invokes this with GET and, when the
// CRON_SECRET env var is set on the project, an `Authorization: Bearer
// <CRON_SECRET>` header. That header is verified below so the endpoint
// can't be triggered by anyone else.
import { runWatch } from "../lib/watchAndUpdate.js";
import { timingSafeStringEqual } from "../lib/auth.js";

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    res.status(500).send("Server misconfigured: CRON_SECRET is not set.");
    return;
  }
  if (!timingSafeStringEqual(req.headers.authorization || "", `Bearer ${cronSecret}`)) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    const result = await runWatch();
    res.status(200).send(result);
  } catch (err) {
    console.error(err);
    res.status(500).send("Internal error. Check server logs.");
  }
}
