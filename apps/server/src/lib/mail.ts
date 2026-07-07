import nodemailer, { type Transporter } from "nodemailer";
import { config } from "../config.js";
import { logger } from "./logger.js";

let transporter: Transporter | null = null;

export function getMailer(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

/**
 * Resend's HTTPS API — the SMTP-less path for PaaS hosts (Sevalla blocks
 * outbound SMTP ports 25/465/587 entirely; 443 always works).
 */
async function sendViaResend(opts: { to: string; subject: string; text: string; html?: string }): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: config.MAIL_FROM,
      to: [opts.to],
      subject: opts.subject,
      text: opts.text,
      ...(opts.html ? { html: opts.html } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`resend api ${res.status}: ${body.slice(0, 300)}`);
  }
}

export async function sendMail(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<void> {
  try {
    if (config.RESEND_API_KEY) {
      await sendViaResend(opts);
    } else {
      await getMailer().sendMail({ from: config.MAIL_FROM, ...opts });
    }
  } catch (err) {
    // Mail must never take the request down; failures are logged and visible in doctor.
    logger.error("sendMail failed", { to: opts.to, subject: opts.subject, err: String(err) });
  }
}
