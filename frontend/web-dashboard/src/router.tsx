/**
 * Router — all route definitions.
 *
 * Structure:
 *   - /login, /register → PublicLayout (no auth)
 *   - / → redirect to /dashboard
 *   - /dashboard, /editor, /drafts, etc. → AppLayout (requires auth)
 *   - * → NotFound
 */

import { Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from './components/Layout/AppLayout';
import { ProtectedRoute } from './components/Layout/ProtectedRoute';

// Pages
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { DashboardPage } from './pages/DashboardPage';
import { EditorPage } from './pages/EditorPage';
import { DraftsPage } from './pages/DraftsPage';
import { PublishPage } from './pages/PublishPage';
import { CheckoutPage } from './pages/CheckoutPage';
import { WalletPage } from './pages/WalletPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { FeedPage } from './pages/FeedPage';
import { SettingsPage } from './pages/SettingsPage';
import { NotFoundPage } from './pages/NotFoundPage';

export function Router(): JSX.Element {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      {/* Protected routes */}
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/editor/:draftId?" element={<EditorPage />} />
        <Route path="/drafts" element={<DraftsPage />} />
        <Route path="/publish/:draftId" element={<PublishPage />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/wallet" element={<WalletPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/feed" element={<FeedPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>

      {/* 404 */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}