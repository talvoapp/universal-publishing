/**
 * Kafka consumer handler for OrderPaid events.
 *
 * RE-EXPORT: This file is a naming-convention alias for
 * `order_paid.ts` (which uses underscore to match the event type).
 *
 * The actual implementation lives in `order_paid.ts`. This file exists
 * because some tooling (and the module layout spec) expects dash-separated
 * filenames. Importing either works — they're the same module.
 */

export { handleOrderPaid } from './order_paid';