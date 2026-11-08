/**
 * DMCA Policy page.
 */

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'DMCA Policy',
  description: 'How to submit a copyright infringement notice or counter-notice.',
};

export default function DMCAPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-16">
      <h1 className="font-serif text-4xl font-bold text-slate-900 mb-2">DMCA Policy</h1>
      <p className="text-sm text-slate-500 mb-10">
        In compliance with 17 U.S.C. § 512 (Digital Millennium Copyright Act)
      </p>

      <div className="article-prose">
        <h2>Designated Agent</h2>
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-6 not-prose">
          <p className="font-medium text-slate-900 mb-2">Copyright Agent</p>
          <p className="text-sm text-slate-700 m-0">
            Universal Publishing<br />
            Attn: DMCA Copyright Agent<br />
            123 Publishing Way<br />
            San Francisco, CA 94105<br />
            Email: <a href="mailto:marklasfar@gmail.com" className="text-brand-600">dmca@upp.local</a>
          </p>
        </div>

        <h2>Filing a Takedown Notice</h2>
        <p>
          If you believe content on Universal Publishing infringes your copyright, send us a
          written notice that includes:
        </p>
        <ol>
          <li>
            A physical or electronic signature of the copyright owner or authorized agent.
          </li>
          <li>
            Identification of the copyrighted work claimed to be infringed (or a
            representative list if multiple works).
          </li>
          <li>
            Identification of the allegedly infringing material and information reasonably
            sufficient to locate it (URL, title, etc.).
          </li>
          <li>Your contact information: address, telephone, email.</li>
          <li>
            A statement that you have a good-faith belief that the use is not authorized by
            the copyright owner, its agent, or the law.
          </li>
          <li>
            A statement, under penalty of perjury, that the information in your notice is
            accurate and that you are the copyright owner or authorized to act on their
            behalf.
          </li>
        </ol>

        <h2>Counter-Notification</h2>
        <p>
          If your content was removed and you believe it was a mistake or misidentification,
          you may file a counter-notification. It must include:
        </p>
        <ol>
          <li>Your physical or electronic signature.</li>
          <li>Identification of the removed content and its former location.</li>
          <li>
            A statement under penalty of perjury that you have a good-faith belief the
            content was removed by mistake or misidentification.
          </li>
          <li>Your name, address, and telephone number.</li>
          <li>
            A statement that you consent to the jurisdiction of the Federal District Court
            for the judicial district in which your address is located (or San Francisco if
            outside the US), and that you will accept service of process from the original
            complainant.
          </li>
        </ol>

        <h2>Our Process</h2>
        <ul>
          <li>
            <strong>Within 24 hours:</strong> We acknowledge receipt of your notice and
            temporarily hide the reported content pending review.
          </li>
          <li>
            <strong>Within 5 business days:</strong> We review the notice, notify the
            uploader, and either remove the content or reject the notice if it's invalid.
          </li>
          <li>
            <strong>After counter-notification:</strong> We forward it to the original
            complainant. If they don't file a court action within 10–14 business days, we
            may restore the content.
          </li>
        </ul>

        <h2>Repeat Infringers</h2>
        <p>
          Users who receive multiple valid DMCA notices will have their accounts suspended or
          terminated. We maintain a strike system: 3 strikes = permanent ban.
        </p>

        <h2>Misrepresentation</h2>
        <p>
          Warning: Under 17 U.S.C. § 512(f), any person who knowingly materially misrepresents
          that material is infringing — or that material was removed by mistake — may be
          liable for damages, including costs and attorneys' fees.
        </p>

        <h2>Contact</h2>
        <p>
          For all DMCA matters, email{' '}
          <a href="mailto:marklasfar@gmail.com">dmca@upp.local</a>. We do not accept DMCA notices
          via our general support channels or social media.
        </p>
      </div>
    </div>
  );
}