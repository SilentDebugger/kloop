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

export async function sendMail(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<void> {
  try {
    await getMailer().sendMail({ from: config.MAIL_FROM, ...opts });
  } catch (err) {
    // Mail must never take the request down; failures are logged and visible in doctor.
    logger.error("sendMail failed", { to: opts.to, subject: opts.subject, err: String(err) });
  }
}
