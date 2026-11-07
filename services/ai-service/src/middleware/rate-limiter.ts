/**
 * Rate limiter middleware — alternate entry point.
 *
 * Context:
 *   The scaffold generated a file named `rate-limiter.ts` (with a hyphen
 *   and no "middleware" suffix), while the routes import from
 *   `rate-limit.middleware.ts`. To avoid breaking anything, this file
 *   simply re-exports the canonical limiters from the real module.
 *
 *   Do NOT add new code here. All rate limiting logic lives in
 *   `rate-limit.middleware.ts`. If you need to add a new limiter,
 *   add it there and re-export it here.
 *
 * Why does this file exist?
 *   - Prevents accidental import churn if some module imported from
 *     `@/middleware/rate-limiter` before we standardized the naming.
 *   - Some tooling (e.g., auto-generated Docker inspect scripts) expects
 *     this filename to exist.
 */

export {
  globalRateLimit,
  suggestRateLimiter,
  feedbackRateLimiter,
} from './rate-limit.middleware';