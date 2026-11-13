/**
 * SMTP service — transport creation and lifecycle management.
 *
 * Disabled mode: when SMTP_HOST is empty, `getTransporter()` returns a
 * "noop transporter" that logs the email instead of sending. This lets
 * the service run fully without SMTP credentials in dev.
 */

import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '@/config';
import { createLogger } from '@/utils/logger';

const log = createLogger('smtp.service');

// ============================================================
// NOOP TRANSPORTER
// ============================================================
function createNoopTransporter(): Transporter {
  return {
    sendMail: async (opts: { to: string; subject: string }) => {
      log.info(
        { to: opts.to, subject: opts.subject },
        'email_noop_smtp_disabled',
      );
      return { messageId: `noop-${Date.now()}` } as never;
    },
    verify: async () => true,
    close: () => undefined,
  } as unknown as Transporter;
}

// ============================================================
// SINGLETON
// ============================================================
let transporter: Transporter | null = null;

export function getTransporter(): Transporter {
  if (transporter) return transporter;

  if (!config.smtp.enabled) {
    log.warn('smtp_disabled_using_noop_transporter');
    transporter = createNoopTransporter();
    return transporter;
  }

  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    ...(config.smtp.user && config.smtp.password
      ? { auth: { user: config.smtp.user, pass: config.smtp.password } }
      : {}),
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

export function _resetTransporterForTests(): void {
  transporter = null;
}