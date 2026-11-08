/**
 * Unit tests for email handler — idempotency, validation, error classification.
 */

import { sendEmail } from '@/handlers/email.handler';
import { PermanentError, TransientError } from '@/utils/errors';

// Mock dependencies
jest.mock('@/services/template.service', () => ({
  renderTemplate: jest.fn().mockResolvedValue({
    subject: 'Test Subject',
    html: '<p>Test</p>',
    text: 'Test',
  }),
}));

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: jest.fn(),
    close: jest.fn(),
  })),
}));

jest.mock('@/db/redis', () => ({
  getRedisClient: jest.fn(() => ({
    exists: jest.fn().mockResolvedValue(0),
    set: jest.fn().mockResolvedValue('OK'),
  })),
  key: (...parts: string[]) => `test:${parts.join(':')}`,
}));

describe('sendEmail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects invalid email', async () => {
    await expect(
      sendEmail({
        to: 'not-an-email',
        template: 'welcome',
        variables: {},
      }),
    ).rejects.toBeInstanceOf(PermanentError);
  });

  it('skips when idempotency key exists', async () => {
    const { getRedisClient } = require('@/db/redis');
    getRedisClient.mockReturnValue({
      exists: jest.fn().mockResolvedValue(1),
      set: jest.fn().mockResolvedValue('OK'),
    });

    // Should not throw, should not send
    await sendEmail({
      to: 'user@example.com',
      template: 'welcome',
      variables: {},
      idempotencyKey: 'existing-key',
    });

    const nodemailer = require('nodemailer');
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
  });
});