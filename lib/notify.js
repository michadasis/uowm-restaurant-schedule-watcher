// Sends email notifications for the watcher via Gmail SMTP. Requires
// GMAIL_USER, GMAIL_APP_PASSWORD, and NOTIFY_EMAIL in the environment; a
// missing notification config just logs and skips sending rather than
// failing the caller, since a notification isn't worth breaking the watch
// itself over.
import nodemailer from "nodemailer";

let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });
  }
  return transporter;
}

export async function sendNotification(subject, text) {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  const to = process.env.NOTIFY_EMAIL;
  if (!user || !pass || !to) {
    console.error("Email notification skipped: GMAIL_USER/GMAIL_APP_PASSWORD/NOTIFY_EMAIL not fully set.");
    return;
  }
  try {
    await getTransporter().sendMail({ from: user, to, subject, text });
  } catch (err) {
    console.error("Failed to send notification email:", err);
  }
}
