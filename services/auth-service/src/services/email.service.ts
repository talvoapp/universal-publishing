/**
 * Email service — Nodemailer wrapper.
 *
 * Provides:
 *   - sendVerificationEmail()
 *   - sendPasswordResetEmail()
 *   - sendWelcomeEmail() (post-verify)
 *
 * Templates are inlined as small HTML strings for simplicity;
 * move to Handlebars/React Email when the design system lands.
 *
 * Failures are logged but never thrown — email delivery must not
 * break the primary auth flow.
 */

import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '@/config';
import { createLogger } from '@/utils/logger';

const log = createLogger('email.service');

// ============================================================
// TRANSPORTER (singleton)
// ============================================================
let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    ...(config.smtp.user && config.smtp.password
      ? { auth: { user: config.smtp.user, pass: config.smtp.password } }
      : {}),
    // Mailhog/STARTTLS won't have valid certs in dev
    tls: config.isProd ? undefined : { rejectUnauthorized: false },
  });

  log.info({ host: config.smtp.host, port: config.smtp.port }, 'SMTP transporter ready');
  return transporter;
}

// ============================================================
// BASE HTML WRAPPER
// ============================================================
function baseHtml(opts: { title: string; body: string; ctaText?: string; ctaUrl?: string }): string {
  const cta = opts.ctaUrl
    ? `<p style="margin:32px 0;">
         <a href="${opts.ctaUrl}"
            style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">
           ${opts.ctaText ?? 'Open'}
         </a>
       </p>
       <p style="color:#6b7280;font-size:12px;">
         Or copy this link: <br/>
         <code>${opts.ctaUrl}</code>
       </p>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${opts.title}</title>
</head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#111827;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table width="560" cellpadding="0" cellspacing="0"
               style="background:#fff;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
          <tr>
            <td>
              <h1 style="margin:0 0 16px;font-size:22px;">${opts.title}</h1>
              ${opts.body}
              ${cta}
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0 16px;" />
              <p style="color:#9ca3af;font-size:12px;margin:0;">
                If you didn't request this email, you can safely ignore it.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ============================================================
// PUBLIC SENDERS
// ============================================================
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:3000';

export async function sendVerificationEmail(input: {
  to: string;
  displayName: string;
  token: string;
}): Promise<void> {
  const url = `${FRONTEND_URL}/auth/verify?token=${encodeURIComponent(input.token)}`;
  const html = baseHtml({
    title: 'Verify your email',
    body: `
      <p>Hi ${escapeHtml(input.displayName)},</p>
      <p>Thanks for signing up. Please verify your email address to unlock publishing, comments, and purchases.</p>
    `,
    ctaText: 'Verify Email',
    ctaUrl: url,
  });

  await send({
    to: input.to,
    subject: 'Verify your email — Universal Publishing Platform',
    html,
  });
}

export async function sendPasswordResetEmail(input: {
  to: string;
  displayName: string;
  token: string;
}): Promise<void> {
  const url = `${FRONTEND_URL}/auth/reset-password?token=${encodeURIComponent(input.token)}`;
  const html = baseHtml({
    title: 'Reset your password',
    body: `
      <p>Hi ${escapeHtml(input.displayName)},</p>
      <p>We received a request to reset your password. This link expires in 1 hour.</p>
    `,
    ctaText: 'Reset Password',
    ctaUrl: url,
  });

  await send({
    to: input.to,
    subject: 'Reset your password — Universal Publishing Platform',
    html,
  });
}

export async function sendWelcomeEmail(input: {
  to: string;
  displayName: string;
}): Promise<void> {
  const html = baseHtml({
    title: 'Welcome aboard 🎉',
    body: `
      <p>Hi ${escapeHtml(input.displayName)},</p>
      <p>Your email is verified and your account is fully active. Start writing, publishing, and selling today.</p>
    `,
    ctaText: 'Open Dashboard',
    ctaUrl: `${FRONTEND_URL}/app`,
  });

  await send({
    to: input.to,
    subject: 'Welcome to Universal Publishing Platform',
    html,
  });
}

// ============================================================
// INTERNAL SEND
// ============================================================
async function send(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  try {
    const info = await getTransporter().sendMail({
      from: config.smtp.from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    });
    log.info(
      { messageId: info.messageId, to: maskEmail(opts.to) },
      'Email sent',
    );
  } catch (err) {
    // Never re-throw — email failure must not break auth.
    log.error({ err, to: maskEmail(opts.to) }, 'Email send failed');
  }
}

// ============================================================
// UTILS
// ============================================================
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '[invalid]';
  const visible = local.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}`;
}