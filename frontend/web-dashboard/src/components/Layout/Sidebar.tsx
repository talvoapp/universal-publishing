/**
 * Sidebar — main navigation.
 */

import { NavLink } from 'react-router-dom';
import { clsx } from 'clsx';
import { useAuthStore } from '@/store/auth.store';
import { initials } from '@/utils/format';

const navItems = [
  {
    to: '/dashboard',
    label: 'Dashboard',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="7" height="9" />
        <rect x="14" y="3" width="7" height="5" />
        <rect x="14" y="12" width="7" height="9" />
        <rect x="3" y="16" width="7" height="5" />
      </svg>
    ),
  },
  {
    to: '/drafts',
    label: 'My Drafts',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
  },
  {
    to: '/feed',
    label: 'Feed',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 11a9 9 0 019 9M4 4a16 16 0 0116 16" />
        <circle cx="5" cy="19" r="1" />
      </svg>
    ),
  },
  {
    to: '/wallet',
    label: 'Wallet',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 12V7H5a2 2 0 010-4h14v4" />
        <path d="M3 5v14a2 2 0 002 2h16v-5" />
        <path d="M18 12a2 2 0 000 4h4v-4z" />
      </svg>
    ),
  },
  {
    to: '/analytics',
    label: 'Analytics',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
  },
];

interface SidebarProps {
  onNavigate: () => void;
}

export function Sidebar({ onNavigate }: SidebarProps) {
  const user = useAuthStore((s) => s.user);

  return (
    <>
      {/* Brand */}
      <div className="px-6 py-5 border-b border-slate-200">
        <NavLink to="/dashboard" className="flex items-center gap-2" onClick={onNavigate}>
          <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center text-white font-bold">
            U
          </div>
          <div>
            <div className="font-bold text-slate-900 text-sm">Universal</div>
            <div className="text-xs text-slate-500">Publishing</div>
          </div>
        </NavLink>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
              )
            }
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* User card */}
      {user && (
        <div className="p-3 border-t border-slate-200">
          <NavLink
            to="/settings"
            onClick={onNavigate}
            className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <div className="w-9 h-9 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 text-sm font-semibold">
              {initials(user.displayName)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-900 truncate">
                {user.displayName}
              </div>
              <div className="text-xs text-slate-500 truncate">{user.role}</div>
            </div>
          </NavLink>
        </div>
      )}
    </>
  );
}