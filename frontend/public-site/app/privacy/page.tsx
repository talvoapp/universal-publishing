/**
 * Privacy Policy page.
 */

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How Universal Publishing collects, uses, and protects your data.',
};

export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-16">
      <h1 className="font-serif text-4xl font-bold text-slate-900 mb-2">Privacy Policy</h1>
      <p className="text-sm text-slate-500 mb-10">Last updated: January 2025</p>

      <div className="article-prose">
        <h2>1. Introduction</h2>
        <p>
          Universal Publishing ("we", "our", "us") respects your privacy. This policy explains
          what data we collect, why, and how you can control it. This policy complies with GDPR
          (EU), CCPA (California), and other applicable privacy laws.
        </p>

        <h2>2. Data We Collect</h2>
        <p>We collect the following categories of data:</p>
        <ul>
          <li>
            <strong>Account data:</strong> email, display name, password hash, avatar, bio.
          </li>
          <li>
            <strong>Content data:</strong> drafts, articles, books, and other content you create.
          </li>
          <li>
            <strong>Transaction data:</strong> purchases, subscriptions, payouts, and tax info.
          </li>
          <li>
            <strong>Usage data:</strong> IP address, browser type, pages visited, and actions
            taken. This is used for security, rate limiting, and analytics.
          </li>
          <li>
            <strong>Payment data:</strong> handled entirely by Stripe. We never see or store
            your full credit card number.
          </li>
        </ul>

        <h2>3. How We Use Your Data</h2>
        <p>We use your data to:</p>
        <ul>
          <li>Provide, maintain, and improve the Service.</li>
          <li>Process transactions and send transactional emails.</li>
          <li>Send notifications about new content, replies, and updates.</li>
          <li>Detect, prevent, and address fraud, abuse, and security issues.</li>
          <li>Comply with legal obligations (tax reporting, DMCA, etc.).</li>
          <li>Communicate with you about changes, offers, or support (opt-in only).</li>
        </ul>

        <h2>4. Legal Basis (GDPR)</h2>
        <p>For EU users, we rely on the following legal bases:</p>
        <ul>
          <li><strong>Contract:</strong> to provide the Service you signed up for.</li>
          <li><strong>Legitimate interests:</strong> security, fraud prevention, service improvement.</li>
          <li><strong>Consent:</strong> marketing communications, cookies (where applicable).</li>
          <li><strong>Legal obligation:</strong> tax and payment records.</li>
        </ul>

        <h2>5. Sharing Your Data</h2>
        <p>We share data only with:</p>
        <ul>
          <li>
            <strong>Stripe:</strong> for payment processing, tax calculation, and Connect payouts.
          </li>
          <li>
            <strong>OpenAI / Anthropic:</strong> for AI writing assistance (only when you use
            AI features; we do not train models on your content).
          </li>
          <li>
            <strong>AWS / Google Cloud:</strong> for hosting and infrastructure.
          </li>
          <li>
            <strong>Law enforcement:</strong> when required by valid legal process.
          </li>
        </ul>
        <p>
          We do <strong>not</strong> sell your personal data.
        </p>

        <h2>6. Your Rights</h2>
        <p>You have the right to:</p>
        <ul>
          <li><strong>Access</strong> your data (download a copy).</li>
          <li><strong>Correct</strong> inaccurate data (edit your profile).</li>
          <li><strong>Delete</strong> your account (available in settings).</li>
          <li><strong>Export</strong> your content (available in settings).</li>
          <li><strong>Opt out</strong> of marketing emails (link in every email).</li>
          <li><strong>Withdraw consent</strong> at any time.</li>
        </ul>
        <p>
          To exercise these rights, email <a href="mailto:marklasfar@gmail.com">privacy@upp.local</a>.
          We respond within 30 days.
        </p>

        <h2>7. Data Retention</h2>
        <p>
          Account data is retained while your account exists. When you delete your account, we
          soft-delete it for 30 days (in case you change your mind), then hard-delete it.
          Financial records are retained for 7 years per tax law.
        </p>

        <h2>8. Security</h2>
        <p>
          We use industry-standard security: TLS in transit, encryption at rest, bcrypt for
          passwords, JWT for sessions, and strict access controls. We run regular security
          audits and penetration tests.
        </p>

        <h2>9. Children</h2>
        <p>
          The Service is not intended for children under 13. If we learn we've collected data
          from a child under 13, we'll delete it immediately.
        </p>

        <h2>10. Changes</h2>
        <p>
          We may update this policy. Material changes will be announced via email and on the
          site at least 30 days before they take effect.
        </p>

        <h2>11. Contact</h2>
        <p>
          Questions? Email <a href="mailto:marklasfar@gmail.com">privacy@upp.local</a> or write to:
          <br />
          Universal Publishing<br />
          Attn: Privacy<br />
          123 Publishing Way<br />
          San Francisco, CA 94105
        </p>
      </div>
    </div>
  );
}