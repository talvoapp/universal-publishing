/**
 * Footer — links + copyright.
 */

import Link from 'next/link';

export function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-slate-50 mt-20">
      <div className="max-w-6xl mx-auto px-4 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-8">
          {/* Product */}
          <div>
            <h3 className="font-semibold text-sm text-slate-900 mb-3">Product</h3>
            <ul className="space-y-2 text-sm text-slate-600">
              <li><Link href="/" className="hover:text-brand-600">Home</Link></li>
              <li><Link href="/search" className="hover:text-brand-600">Discover</Link></li>
              <li>
                <Link href="http://localhost:3000/register" className="hover:text-brand-600">
                  Start writing
                </Link>
              </li>
            </ul>
          </div>

          {/* Company */}
          <div>
            <h3 className="font-semibold text-sm text-slate-900 mb-3">Company</h3>
            <ul className="space-y-2 text-sm text-slate-600">
              <li><Link href="/terms" className="hover:text-brand-600">Terms</Link></li>
              <li><Link href="/privacy" className="hover:text-brand-600">Privacy</Link></li>
              <li><Link href="/dmca" className="hover:text-brand-600">DMCA</Link></li>
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h3 className="font-semibold text-sm text-slate-900 mb-3">Resources</h3>
            <ul className="space-y-2 text-sm text-slate-600">
              <li>
                <a href="http://localhost:8080/docs" className="hover:text-brand-600">
                  API Docs
                </a>
              </li>
              <li>
                <a href="mailto:marklasfar@gmail.com" className="hover:text-brand-600">
                  Support
                </a>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h3 className="font-semibold text-sm text-slate-900 mb-3">Legal</h3>
            <ul className="space-y-2 text-sm text-slate-600">
              <li><Link href="/privacy" className="hover:text-brand-600">Privacy Policy</Link></li>
              <li><Link href="/terms" className="hover:text-brand-600">Terms of Service</Link></li>
            </ul>
          </div>
        </div>

        <div className="pt-8 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-slate-500">
          <p>© {new Date().getFullYear()} Universal Publishing. All rights reserved.</p>
          <p>Made with ❤ for authors and readers</p>
        </div>
      </div>
    </footer>
  );
}