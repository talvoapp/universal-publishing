/**
 * Navbar — logo, search, sign in/up.
 */

import Link from 'next/link';

export function Navbar() {
  return (
    <header className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-slate-200">
      <nav className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 flex-shrink-0">
          <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center text-white font-bold">
            U
          </div>
          <span className="hidden sm:block font-bold text-slate-900">Universal</span>
        </Link>

        {/* Search */}
        <form action="/search" method="GET" className="flex-1 max-w-md">
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              type="search"
              name="q"
              placeholder="Search articles, books, authors…"
              className="w-full pl-9 pr-4 py-2 text-sm bg-slate-100 border border-transparent rounded-lg focus:bg-white focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
            />
          </div>
        </form>

        {/* Auth links */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <Link
            href="http://localhost:3000/login"
            className="hidden sm:inline-flex text-sm font-medium text-slate-700 hover:text-brand-600 px-3 py-2"
          >
            Sign in
          </Link>
          <Link
            href="http://localhost:3000/register"
            className="inline-flex bg-brand-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-brand-700 transition"
          >
            Get started
          </Link>
        </div>
      </nav>
    </header>
  );
}