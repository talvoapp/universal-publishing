/**
 * Quota service integration tests.
 *
 * These verify the atomic reserve/adjust logic against a real Redis.
 * No provider calls are made.
 */

import { Types } from 'mongoose';
import * as quotaService from '@/services/quota.service';
import { getRedisClient, quotaKey } from '@/db/redis';
import { config } from '@/config';
import { QuotaExceededError } from '@/utils/errors';
import { createTestUser } from './helpers';

// ============================================================
// TIER RESOLUTION
// ============================================================
describe('Tier resolution', () => {
  it.each([
    ['reader', 'free', config.quotas.tiers.free],
    ['author', 'premium', config.quotas.tiers.premium],
    ['editor', 'premium', config.quotas.tiers.premium],
    ['admin', 'admin', config.quotas.tiers.admin],
  ] as const)('%s → %s (%d tokens)', async (role, expectedTier, expectedLimit) => {
    const user = createTestUser({ role });
    const status = await quotaService.getQuotaStatus({ userId: user.id, role });
    expect(status.tier).toBe(expectedTier);
    expect(status.limit).toBe(expectedLimit);
  });
});

// ============================================================
// RESERVE
// ============================================================
describe('checkAndReserveQuota', () => {
  it('grants reservation for a fresh user', async () => {
    const user = createTestUser({ role: 'reader' });
    const res = await quotaService.checkAndReserveQuota({
      userId: user.id,
      role: 'reader',
      estimatedTokens: 500,
    });
    expect(res.used).toBe(500);
    expect(res.remaining).toBe(config.quotas.tiers.free - 500);
    expect(res.reserved).toBe(500);
  });

  it('accumulates across calls', async () => {
    const user = createTestUser({ role: 'reader' });
    await quotaService.checkAndReserveQuota({
      userId: user.id,
      role: 'reader',
      estimatedTokens: 1000,
    });
    const second = await quotaService.checkAndReserveQuota({
      userId: user.id,
      role: 'reader',
      estimatedTokens: 2000,
    });
    expect(second.used).toBe(3000);
  });

  it('rejects when reservation would exceed the limit (no over-consumption)', async () => {
    const user = createTestUser({ role: 'reader' }); // 5,000 free
    // Reserve 4,900
    await quotaService.checkAndReserveQuota({
      userId: user.id,
      role: 'reader',
      estimatedTokens: 4900,
    });
    // Attempt to reserve 200 more → must fail, and counter must stay at 4900
    await expect(
      quotaService.checkAndReserveQuota({
        userId: user.id,
        role: 'reader',
        estimatedTokens: 200,
      }),
    ).rejects.toBeInstanceOf(QuotaExceededError);

    // Verify the failed reservation was rolled back
    const status = await quotaService.getQuotaStatus({ userId: user.id, role: 'reader' });
    expect(status.used).toBe(4900);
  });
});

// ============================================================
// RECORD ACTUAL USAGE
// ============================================================
describe('recordActualUsage', () => {
  it('adjusts UP when actual > reserved', async () => {
    const user = createTestUser({ role: 'reader' });
    await quotaService.checkAndReserveQuota({
      userId: user.id,
      role: 'reader',
      estimatedTokens: 500,
    });
    // Actual was 800 — adjust +300
    await quotaService.recordActualUsage({
      userId: user.id,
      reserved: 500,
      actual: 800,
    });
    const status = await quotaService.getQuotaStatus({ userId: user.id, role: 'reader' });
    expect(status.used).toBe(800);
  });

  it('adjusts DOWN when actual < reserved', async () => {
    const user = createTestUser({ role: 'reader' });
    await quotaService.checkAndReserveQuota({
      userId: user.id,
      role: 'reader',
      estimatedTokens: 2000,
    });
    // Actual was 1000 — refund 1000
    await quotaService.recordActualUsage({
      userId: user.id,
      reserved: 2000,
      actual: 1000,
    });
    const status = await quotaService.getQuotaStatus({ userId: user.id, role: 'reader' });
    expect(status.used).toBe(1000);
  });

  it('never goes below zero on over-refund', async () => {
    const user = createTestUser({ role: 'reader' });
    await quotaService.checkAndReserveQuota({
      userId: user.id,
      role: 'reader',
      estimatedTokens: 100,
    });
    await quotaService.recordActualUsage({
      userId: user.id,
      reserved: 100,
      actual: 0,
    });
    const status = await quotaService.getQuotaStatus({ userId: user.id, role: 'reader' });
    expect(status.used).toBe(0);
  });
});

// ============================================================
// TTL / RESET
// ============================================================
describe('Quota key TTL', () => {
  it('sets a TTL on the counter', async () => {
    const user = createTestUser({ role: 'reader' });
    await quotaService.checkAndReserveQuota({
      userId: user.id,
      role: 'reader',
      estimatedTokens: 100,
    });
    const ymd = new Date().toISOString().slice(0, 10);
    const redis = getRedisClient();
    const ttl = await redis.ttl(quotaKey(user.id, ymd));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(config.quotas.windowHours * 3600);
  });
});

// ============================================================
// STATUS
// ============================================================
describe('getQuotaStatus', () => {
  it('reports zero usage for a new user', async () => {
    const user = createTestUser({ role: 'author' });
    const status = await quotaService.getQuotaStatus({ userId: user.id, role: 'author' });
    expect(status.used).toBe(0);
    expect(status.remaining).toBe(config.quotas.tiers.premium);
    expect(status.at_warning).toBe(false);
    expect(new Date(status.reset_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('flags at_warning when usage crosses the threshold', async () => {
    const user = createTestUser({ role: 'reader' });
    const limit = config.quotas.tiers.free;
    const threshold = Math.ceil((limit * config.quotas.warningThresholdPct) / 100);

    await quotaService.checkAndReserveQuota({
      userId: user.id,
      role: 'reader',
      estimatedTokens: threshold,
    });

    const status = await quotaService.getQuotaStatus({ userId: user.id, role: 'reader' });
    expect(status.at_warning).toBe(true);
  });
});

// avoid unused import warnings
void Types;