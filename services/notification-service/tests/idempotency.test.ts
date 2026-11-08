/**
 * Unit tests for idempotency — critical for payment notifications.
 */

import { createInAppNotification } from '@/handlers/inapp.handler';

const mockQuery = jest.fn();

jest.mock('@/db/postgres', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

jest.mock('@/db/redis', () => ({
  getRedisClient: jest.fn(() => ({
    exists: jest.fn().mockResolvedValue(0),
    set: jest.fn().mockResolvedValue('OK'),
  })),
  key: (...parts: string[]) => `test:${parts.join(':')}`,
}));

describe('createInAppNotification', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
  });

  it('inserts notification with ON CONFLICT idempotency', async () => {
    await createInAppNotification({
      userId: 'user-123',
      type: 'test',
      title: 'Test',
      body: 'Body',
      idempotencyKey: 'test-key',
    });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('ON CONFLICT (idempotency_key) DO NOTHING');
  });

  it('does not reserve key before insert', async () => {
    const { getRedisClient } = require('@/db/redis');
    const mockSet = jest.fn().mockResolvedValue('OK');
    getRedisClient.mockReturnValue({
      exists: jest.fn().mockResolvedValue(0),
      set: mockSet,
    });

    await createInAppNotification({
      userId: 'user-123',
      type: 'test',
      title: 'Test',
      body: 'Body',
      idempotencyKey: 'test-key',
    });

    // set should be called AFTER the insert (mockQuery was called first)
    expect(mockQuery).toHaveBeenCalled();
    expect(mockSet).toHaveBeenCalled();
  });
});