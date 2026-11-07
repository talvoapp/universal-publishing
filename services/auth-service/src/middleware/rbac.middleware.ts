/**
 * Role-Based Access Control (RBAC).
 *
 * Roles are hierarchical:
 *   reader < author < editor < admin
 *
 * Usage in routes:
 *   router.get('/admin-only', requireAuth, requireRole('admin'), handler);
 *   router.post('/publish',   requireAuth, requireRole('author'), handler);
 *   router.delete('/x',       requireAuth, requireRole('admin', 'editor'), handler);
 *
 * `requireRole` accepts any of the listed roles (OR semantics).
 * To require all roles (rare), call it multiple times in the chain.
 */

import type { Request, Response, NextFunction } from 'express';
import { ForbiddenError, UnauthorizedError } from '@/utils/errors';
import type { AuthRole } from '@/middleware/auth.middleware';
import { createLogger } from '@/utils/logger';

const log = createLogger('rbac');

// ============================================================
// ROLE HIERARCHY
// ============================================================
const ROLE_LEVEL: Record<AuthRole, number> = {
  reader: 1,
  author: 2,
  editor: 3,
  admin: 4,
};

/**
 * Returns true if `actual` >= `required` in the hierarchy.
 */
export function hasRoleLevel(actual: AuthRole, required: AuthRole): boolean {
  return ROLE_LEVEL[actual] >= ROLE_LEVEL[required];
}

// ============================================================
// REQUIRE ROLE — OR semantics
// ============================================================
export function requireRole(...allowed: AuthRole[]) {
  if (allowed.length === 0) {
    throw new Error('requireRole() requires at least one role');
  }
  // Precompute Set for O(1) lookup
  const allowedSet = new Set<AuthRole>(allowed);

  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new UnauthorizedError('Authentication required');
    }

    if (!allowedSet.has(req.user.role)) {
      log.warn(
        { userId: req.user.id, actual: req.user.role, allowed },
        'Role check failed',
      );
      throw new ForbiddenError(
        `This action requires one of: ${allowed.join(', ')}`,
      );
    }

    next();
  };
}

// ============================================================
// REQUIRE MIN LEVEL — hierarchical semantics
// ============================================================
/**
 * Grants access to `minimum` role or higher.
 *   requireMinRole('editor') → editor + admin
 */
export function requireMinRole(minimum: AuthRole) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw new UnauthorizedError('Authentication required');
    if (!hasRoleLevel(req.user.role, minimum)) {
      log.warn(
        { userId: req.user.id, actual: req.user.role, minimum },
        'Min-level role check failed',
      );
      throw new ForbiddenError(`Requires ${minimum} role or higher`);
    }
    next();
  };
}

// ============================================================
// REQUIRE VERIFIED EMAIL
// ============================================================
/**
 * Some actions (publishing, payments) require a verified email.
 */
export function requireVerifiedEmail(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (!req.user) throw new UnauthorizedError('Authentication required');
  if (!req.user.emailVerified) {
    throw new ForbiddenError('Email verification required');
  }
  next();
}

// ============================================================
// REQUIRE SELF OR ADMIN
// ============================================================
/**
 * Guards routes like `PATCH /users/:id` where the caller must either
 * be the target user OR an admin.
 */
export function requireSelfOrAdmin(param = 'id') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw new UnauthorizedError('Authentication required');
    const target = req.params[param];
    if (req.user.role === 'admin' || req.user.id === target) {
      return next();
    }
    throw new ForbiddenError('You can only modify your own resources');
  };
}