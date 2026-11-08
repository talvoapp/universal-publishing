/**
 * SMTP service — transport creation and lifecycle management.
 *
 * Extracted from email.handler.ts so the transporter can be:
 *   - Reused (no re-instantiation per send)
 *   - Tested independently (mock getTransporter)
 *   - Closed gracefully on shutdown
 *
 * The email handler uses this service; it never touches nodemailer
 * directly.
 */

import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '@/config';
import { createLogger } from '@/utils/logger';

const log = createLogger('smtp.service');

// ============================================================
// SINGLETON
// ============================================================
let transporter: Transporter | null = null;

/**
 * Returns the shared SMTP transporter (created on first use).
 */
export function getTransporter(): Transporter {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    ...(config.smtp.user && config.smtp.password
      ? { auth: { user: config.smtp.user, pass: config.smtp.password } }
      : {}),
    // Mailhog in dev doesn't have valid certs
    tls: config.isProd ? undefined : { rejectUnauthorized: false },
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
  });

  log.info(
    { host: config.smtp.host, port: config.smtp.port, secure: config.smtp.secure },
    'smtp_transporter_ready',
  );
  return transporter;
}

/**
 * Closes the transporter. Called during graceful shutdown.
 */
export async function closeTransporter(): Promise<void> {
  if (!transporter) return;
  try {
    transporter.close();
    log.info('smtp_transporter_closed');
  } catch (err) {
    log.warn({ err }, 'smtp_transporter_close_failed');
  }
  transporter = null;
}

/**
 * Verifies SMTP connectivity (for /ready or diagnostics).
 */
export async function verifyTransporter(): Promise<boolean> {
  try {
    const t = getTransporter();
    await t.verify();
    return true;
  } catch (err) {
    log.warn({ err }, 'smtp_verify_failed');
    return false;
  }
}

// For tests — reset the singleton
export function _resetTransporterForTests(): void {
  transporter = null;
}