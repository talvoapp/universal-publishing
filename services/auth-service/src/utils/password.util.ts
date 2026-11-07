/**
 * Password hashing & verification.
 *
 * Uses bcrypt with a rounds value from config (validated at startup to
 * be between 10 and 15). We normalize nothing here — the caller must
 * already have trimmed the input and enforced the length policy via Zod.
 *
 * Note on cost/rounds:
 *   - 10 ≈ 100ms   (weak hardware)
 *   - 12 ≈ 250ms   (recommended default; balances security and UX)
 *   - 14 ≈ 1000ms  (hardened environments)
 *
 * The chosen default in .env.example is 12.
 */

import bcrypt from 'bcrypt';
import { config } from '@/config';

// ============================================================
// HASH
// ============================================================
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, config.password.bcryptRounds);
}

// ============================================================
// VERIFY
// ============================================================
/**
 * Constant-time comparison handled by bcrypt itself.
 * Returns false on any internal error (bad hash format, etc.) —
 * callers should not need to try/catch.
 */
export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

// ============================================================
// PARSE HASH (for diagnostics / migration)
// ============================================================
/**
 * Returns the cost (rounds) embedded in a bcrypt hash string, or null
 * if the string is not a valid bcrypt hash. Useful for detecting users
 * whose password_hash was created with a weaker cost and needs rehash
 * on next successful login.
 */
export function getBcryptCost(hash: string): number | null {
  // bcrypt hashes look like: $2b$12$<22-char-salt><31-char-hash>
  const match = /^\$2[aby]\$(\d{2})\$[./A-Za-z0-9]{53}$/.exec(hash);
  if (!match || !match[1]) return null;
  return parseInt(match[1], 10);
}

/**
 * True if the given hash was created with a cost lower than the current
 * configured rounds. Caller may rehash transparently after a successful
 * password verification.
 */
export function needsRehash(hash: string): boolean {
  const cost = getBcryptCost(hash);
  return cost !== null && cost < config.password.bcryptRounds;
}