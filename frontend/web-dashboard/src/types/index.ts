/**
 * Centralized type definitions for the web dashboard.
 *
 * These mirror the API contracts (see docs/openapi/). Keep in sync.
 */

// ============================================================
// AUTH / USER
// ============================================================
export type AuthRole = 'reader' | 'author' | 'editor' | 'admin';

export interface User {
  id: string;
  email: string;
  displayName: string;
  bio?: string | null;
  avatarUrl?: string | null;
  language: string;
  role: AuthRole;
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

// ============================================================
// DRAFTS / EDITOR
// ============================================================
export type DraftStatus = 'draft' | 'published' | 'archived' | 'deleted';
export type ContentType = 'article' | 'book' | 'news_post';

export interface Draft {
  id: string;
  ownerId: string;
  title: string;
  contentType: ContentType;
  language: string;
  content: string;
  metadata: Record<string, unknown>;
  status: DraftStatus;
  version: number;
  wordCount: number;
  readTimeMinutes: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DraftSummary {
  id: string;
  title: string;
  contentType: ContentType;
  status: DraftStatus;
  wordCount: number;
  updatedAt: string;
}

export interface Chapter {
  chapterId: string;
  index: number;
  title: string;
  wordCount: number;
  free: boolean;
}

export interface VersionEntry {
  version: number;
  userId: string;
  opCount: number;
  createdAt: string;
}

// ============================================================
// WEBSOCKET PROTOCOL (matches editor-service)
// ============================================================
export type WSFrame =
  | { type: 'auth'; token: string }
  | { type: 'subscribe'; draftId: string; sinceVersion?: number }
  | { type: 'patch'; baseVersion: number; ops: unknown[]; clientOpId: string }
  | { type: 'presence'; cursorPosition?: number }
  | { type: 'ping' };

export type WSEvent =
  | { type: 'auth_ok'; userId: string }
  | { type: 'subscribed'; draftId: string; version: number; snapshot: Record<string, unknown> }
  | { type: 'ack'; clientOpId: string; version: number; serverTime: number }
  | { type: 'nack'; clientOpId: string; reason: string; serverVersion?: number }
  | { type: 'patch'; baseVersion: number; ops: unknown[]; clientOpId: string; userId: string; version: number }
  | { type: 'presence'; users: Array<{ userId: string; cursorPosition: number | null; lastSeen: string }> }
  | { type: 'error'; code: string; detail: string }
  | { type: 'pong'; serverTime: number };

// ============================================================
// AI
// ============================================================
export type AIOperation = 'grammar' | 'rephrase' | 'summarize' | 'expand' | 'generate';

export interface AISuggestRequest {
  draftId?: string;
  operation: AIOperation;
  selection: { text?: string; from?: number; to?: number };
  instruction?: string;
  tone?: 'neutral' | 'formal' | 'casual' | 'friendly' | 'authoritative';
  sessionId?: string;
}

export interface AIQuota {
  tier: 'free' | 'premium' | 'admin';
  limit: number;
  used: number;
  remaining: number;
  reset_at: string;
  warning_threshold_pct: number;
  at_warning: boolean;
}

// ============================================================
// MARKETPLACE
// ============================================================
export type PricingModel = 'pay_per_book' | 'pay_per_chapter' | 'subscription';

export interface Item {
  id: string;
  draftId: string;
  authorId: string;
  type: ContentType | 'news_channel';
  pricingModel: PricingModel;
  title: string;
  description?: string;
  coverUrl?: string | null;
  language: string;
  tags: string[];
  priceCents: number;
  currency: string;
  freeChapters: number[];
  isPublished: boolean;
  wordCount: number;
  readMinutes: number;
  createdAt: string;
  updatedAt: string;
}

export interface CheckoutResponse {
  order_id: string;
  checkout_url: string;
  checkout_session: string;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  currency: string;
  tax_jurisdiction: string;
}

// ============================================================
// WALLET
// ============================================================
export interface WalletSummary {
  authorId: string;
  currency: string;
  available: string;
  pending: string;
  lifetime: string;
  paidOut: string;
  connectStatus: 'not_onboarded' | 'pending' | 'active' | 'restricted' | 'disabled';
}

export interface LedgerEntry {
  transactionId: string;
  type: string;
  reference: string;
  accountType: string;
  accountKey: string;
  debit: string;
  credit: string;
  currency: string;
  occurredAt: string;
  createdAt: string;
}

export type PayoutStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface Payout {
  id: string;
  amount: string;
  currency: string;
  status: PayoutStatus;
  stripeTransferId?: string;
  reason?: string;
  requestedAt: string;
  completedAt?: string;
  failedAt?: string;
}

export interface ConnectStatus {
  status: 'not_onboarded' | 'pending' | 'active' | 'restricted' | 'disabled';
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requirementsDue: string[];
}

export interface AnalyticsResult {
  period: string;
  currency: string;
  grossRevenue: string;
  platformFees: string;
  netEarnings: string;
  saleCount: number;
  daily: Array<{ date: string; amount: string }>;
}

// ============================================================
// FEED
// ============================================================
export interface Post {
  id: string;
  authorId: string;
  title: string;
  excerpt: string;
  contentType: string;
  wordCount: number;
  tags?: string[];
  publishedAt: string;
}

export interface FeedPage {
  posts: Post[];
  nextCursor?: string;
  hasMore: boolean;
}

// ============================================================
// API ERROR (RFC 7807)
// ============================================================
export interface APIError {
  type: string;
  title: string;
  status: number;
  detail: string;
  code?: string;
  instance?: string;
  errors?: Array<{ path: string; message: string; code: string }>;
}

export interface PaginatedResponse<T> {
  data: T[];
  next_cursor: string | null;
}