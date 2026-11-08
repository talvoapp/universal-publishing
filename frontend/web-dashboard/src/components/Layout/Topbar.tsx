/**
 * Topbar — mobile menu toggle + page title area + user menu.
 */

import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '@/store/auth.store';
import { initials } from '@/utils/format';

interface TopbarProps {
  onMenuClick: () => void;
}

export function Topbar({ onMenuClick }: TopbarProps) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-20 bg-white border-b border-slate-200 px-4 lg:px-6 h-14 flex items-center justify-between">
      {/* Left: mobile menu toggle */}
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="lg:hidden p-2 rounded-lg hover:bg-slate-100"
          aria-label="Open menu"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <Link to="/editor" className="hidden sm:inline-flex items-center gap-2 bg-brand-600 text-white text-sm font-medium px-4 py-1.5 rounded-lg hover:bg-brand-700">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Draft
        </Link>
      </div>

      {/* Right: user menu */}
      <div className="flex items-center gap-2">
        {user && (
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-slate-100"
              aria-label="User menu"
              aria-expanded={menuOpen}
            >
              <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 text-sm font-semibold">
                {initials(user.displayName)}
              </div>
              <svg className="hidden sm:block" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {menuOpen && (
              <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-slate-200 py-1 animate-fade-in">
                <div className="px-4 py-2 border-b border-slate-100">
                  <div className="text-sm font-medium text-slate-900 truncate">{user.displayName}</div>
                  <div className="text-xs text-slate-500 truncate">{user.email}</div>
                </div>
                <Link to="/settings" onClick={() => setMenuOpen(false)} className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                  Settings
                </Link>
                <Link to="/wallet" onClick={() => setMenuOpen(false)} className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                  Wallet
                </Link>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    void logout();
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-danger-600 hover:bg-danger-50 border-t border-slate-100"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}