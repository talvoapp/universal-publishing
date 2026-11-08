/**
 * Centralized types for the mobile app.
 *
 * Mirrors `web-dashboard/src/types` but trimmed to only what mobile needs.
 */

// ============================================================
// AUTH
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
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

// ============================================================
// DRAFTS
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
// MARKETPLACE
// ============================================================
export interface Item {
  id: string;
  draftId: string;
  authorId: string;
  type: ContentType | 'news_channel';
  pricingModel: 'pay_per_book' | 'pay_per_chapter' | 'subscription';
  title: string;
  description?: string;
  coverUrl?: string | null;
  language: string;
  tags: string[];
  priceCents: number;
  currency: string;
  wordCount: number;
  isPublished: boolean;
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

// ============================================================
// API ERROR (RFC 7807)
// ============================================================
export interface APIError {
  type: string;
  title: string;
  status: number;
  detail: string;
  code?: string;
}