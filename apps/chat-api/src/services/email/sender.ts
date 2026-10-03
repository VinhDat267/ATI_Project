import nodemailer from "nodemailer";
import type pg from "pg";
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}
export class OutboxEmailSender implements EmailSender {
  constructor(private pool: pg.Pool) {}
  async send(message: EmailMessage) {
    await this.pool.query(
      "INSERT INTO email_outbox(to_address,subject,body_text,body_html) VALUES($1,$2,$3,$4)",
      [message.to, message.subject, message.text, message.html],
    );
  }
}
export function createSmtpSender(
  env: Record<string, string | undefined>,
): EmailSender {
  for (const key of [
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "MAIL_FROM",
    "APP_BASE_URL",
  ])
    if (!env[key])
      throw new Error(`${key} is required for live account verification`);
  const port = Number(env.SMTP_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid SMTP_PORT");
  const url = new URL(env.APP_BASE_URL!);
  if (url.protocol !== "https:")
    throw new Error("APP_BASE_URL must use HTTPS in live mode");
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
  });
  return {
    async send(message) {
      await transport.sendMail({
        from: env.MAIL_FROM,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    },
  };
}
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export async function sendAccountEmail(
  sender: EmailSender,
  message: Omit<EmailMessage, "html">,
) {
  try {
    await sender.send({
      ...message,
      html: `<p>${escape(message.text).replaceAll("\n", "<br>")}</p>`,
    });
  } catch {
    console.warn(
      "[auth-email] Delivery failed; verification can be requested again.",
    );
  }
}
