/**
 * Terms of Service page.
 */

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'The rules for using Universal Publishing.',
};

export default function TermsPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-16">
      <h1 className="font-serif text-4xl font-bold text-slate-900 mb-2">Terms of Service</h1>
      <p className="text-sm text-slate-500 mb-10">Last updated: January 2025</p>

      <div className="article-prose">
        <h2>1. Agreement</h2>
        <p>
          By using Universal Publishing (the "Service"), you agree to these Terms. If you don't
          agree, do not use the Service.
        </p>

        <h2>2. Eligibility</h2>
        <p>
          You must be at least 13 years old to use the Service. If you're under 18, you need
          permission from a parent or guardian. If you use the Service on behalf of a company,
          you represent that you have authority to bind them.
        </p>

        <h2>3. Your Account</h2>
        <p>
          You're responsible for your account and password. Don't share your password. Notify
          us immediately at <a href="mailto:marklasfar@gmail.com">security@upp.local</a> if you
          suspect unauthorized access.
        </p>

        <h2>4. Your Content</h2>
        <p>
          You retain ownership of the content you create. By publishing on the Service, you
          grant us a worldwide, non-exclusive, royalty-free license to host, display, and
          distribute your content within the Service.
        </p>
        <p>You agree NOT to publish:</p>
        <ul>
          <li>Content that infringes someone else's copyright or trademark.</li>
          <li>Content that is defamatory, harassing, or hateful.</li>
          <li>Content that is illegal in your jurisdiction or ours.</li>
          <li>Spam, malware, or misleading content.</li>
          <li>Content that violates someone's privacy (doxing, non-consensual imagery).</li>
        </ul>

        <h2>5. Monetization</h2>
        <p>
          Authors can sell content through the Service. The platform retains a 15% fee on
          each sale. Payouts are made via Stripe Connect. You're responsible for any taxes
          on your earnings.
        </p>

        <h2>6. Purchases</h2>
        <p>
          All purchases are final. If you believe you've been charged in error, contact us
          within 30 days. Refunds are granted at our discretion per our refund policy.
        </p>

        <h2>7. Prohibited Uses</h2>
        <p>You agree NOT to:</p>
        <ul>
          <li>Scrape the Service or copy content without permission.</li>
          <li>Attempt to bypass paywalls or DRM.</li>
          <li>Use the Service to send spam or unsolicited messages.</li>
          <li>Interfere with the Service's operation or security.</li>
          <li>Impersonate someone else.</li>
          <li>Use automated tools to access the Service without permission.</li>
        </ul>

        <h2>8. Intellectual Property</h2>
        <p>
          The Service itself (excluding user content) — including its code, design, and
          branding — is owned by Universal Publishing and protected by copyright and trademark
          law.
        </p>

        <h2>9. DMCA</h2>
        <p>
          We comply with the Digital Millennium Copyright Act. See our{' '}
          <a href="/dmca">DMCA Policy</a> for details.
        </p>

        <h2>10. Termination</h2>
        <p>
          We may suspend or terminate your account for violations of these Terms. You may
          delete your account at any time from Settings.
        </p>

        <h2>11. Disclaimers</h2>
        <p>
          THE SERVICE IS PROVIDED "AS IS" WITHOUT WARRANTIES OF ANY KIND. WE DISCLAIM ALL
          IMPLIED WARRANTIES, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE,
          AND NON-INFRINGEMENT.
        </p>

        <h2>12. Limitation of Liability</h2>
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE'RE NOT LIABLE FOR ANY INDIRECT,
          INCIDENTAL, SPECIAL, OR CONSEQUENTIAL DAMAGES. OUR TOTAL LIABILITY IS LIMITED TO
          THE AMOUNT YOU PAID US IN THE LAST 12 MONTHS.
        </p>

        <h2>13. Governing Law</h2>
        <p>
          These Terms are governed by the laws of the State of California, USA, without
          regard to its conflict of laws provisions. Disputes will be resolved in the state
          or federal courts of San Francisco County, California.
        </p>

        <h2>14. Changes</h2>
        <p>
          We may update these Terms. Material changes will be announced at least 30 days
          before they take effect. Continued use after changes means acceptance.
        </p>

        <h2>15. Contact</h2>
        <p>
          Questions about these Terms? Email{' '}
          <a href="mailto:marklasfar@gmail.com">legal@upp.local</a>.
        </p>
      </div>
    </div>
  );
}