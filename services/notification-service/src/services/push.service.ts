/**
 * Push notification service.
 *
 * DEPRECATED PATH: The implementation moved to
 * `@/handlers/push.handler`. This file re-exports it so existing
 * imports (`import { sendPush } from '@/services/push.service'`)
 * continue to work without change.
 *
 * New code should import from `@/handlers/push.handler` directly.
 */

export { sendPush } from '@/handlers/push.handler';
export type { SendPushInput } from '@/types/index';