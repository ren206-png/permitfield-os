import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal/legal-page';
import { LEGAL_CONTACT_EMAIL, PRODUCT_NAME } from '@/lib/brand';

export const metadata: Metadata = { title: `Privacy policy | ${PRODUCT_NAME}` };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy">
      <p>
        {PRODUCT_NAME} (&ldquo;we&rdquo;, &ldquo;us&rdquo;) helps trade contractors prepare, sign and submit permit applications, and
        manage estimates and invoices. This policy explains what information we handle, why, who helps us process it, and the
        choices you have. Questions: <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li>
          <strong>Account information:</strong> your name and email address, and your password (stored only as a secure hash).
          If you sign in with Google or Microsoft, we receive your name and email address from them &mdash; never your password.
        </li>
        <li>
          <strong>Organization and team:</strong> your company details, the people you invite and their roles.
        </li>
        <li>
          <strong>Project and application data:</strong> project addresses, scopes of work, contractor licence details, documents
          and drawings you upload, and the permit forms the service fills in.
        </li>
        <li>
          <strong>Your clients&apos; information:</strong> names, email addresses and details you enter for estimates, invoices,
          change orders and client links. You are responsible for having the right to share it with us.
        </li>
        <li>
          <strong>Electronic signatures:</strong> the typed or drawn signature, the signer&apos;s name and email, the consent they
          gave, the time, IP address and browser, and a fingerprint of the signed document &mdash; kept as a record of the signature.
        </li>
        <li>
          <strong>Payments:</strong> handled by Stripe. We do not receive or store full card numbers.
        </li>
        <li>
          <strong>Technical information:</strong> logs, IP addresses and basic usage statistics (Vercel Web Analytics, which does
          not use cookies) to run, secure and improve the service.
        </li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To provide the service: fill in permit forms, review documents, collect signatures, send estimates, invoices and reminders.</li>
        <li>
          To process documents with AI: document text is sent to our AI providers to extract information and flag issues. Results
          are suggestions for you to review, not legal or code advice.
        </li>
        <li>To send the emails you ask for, including submissions to permitting authorities when you choose to submit.</li>
        <li>To keep accounts secure, prevent abuse, and meet legal obligations.</li>
      </ul>
      <p>We do not sell your information, and we do not use it for advertising.</p>

      <h2>Who processes it for us</h2>
      <p>We use these providers only to deliver the service, under agreements that limit their use of your data:</p>
      <ul>
        <li>Supabase &mdash; database, file storage and sign-in (hosted in the United States).</li>
        <li>Vercel &mdash; website hosting and privacy-friendly analytics.</li>
        <li>Anthropic and Voyage AI &mdash; AI processing of document text.</li>
        <li>Resend &mdash; sending email.</li>
        <li>Inngest &mdash; running background tasks.</li>
        <li>Stripe &mdash; payments.</li>
        <li>Google and Microsoft &mdash; only if you choose to sign in with them.</li>
      </ul>
      <p>
        We also share an application with a permitting authority when you submit it, and information with a signer when you
        send them something to sign. We may disclose information if required by law.
      </p>

      <h2>Where your information is stored</h2>
      <p>
        Our providers store and process information in the United States and other countries, so it may be subject to the laws of
        those countries. We protect it with encryption in transit, strict separation between organizations, and access controls.
      </p>

      <h2>How long we keep it</h2>
      <p>
        We keep your information while your account is active and as needed to provide the service. Signature and audit records
        are kept as evidence of what was signed and submitted. When you ask us to delete your account, we delete or anonymize your
        information unless we must keep it by law.
      </p>

      <h2>Your choices and rights</h2>
      <p>
        You can see and update most of your information in the app. You can ask us for a copy of your personal information, ask us
        to correct or delete it, or withdraw consent, by emailing <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>.
        If you are in Canada, you may also contact the Office of the Privacy Commissioner of Canada.
      </p>

      <h2>Cookies</h2>
      <p>We use only the cookies needed to keep you signed in and remember your settings. We do not use advertising cookies.</p>

      <h2>Children</h2>
      <p>The service is for businesses and is not directed to children.</p>

      <h2>Changes</h2>
      <p>We will post any changes here and update the date above. Significant changes will be announced in the app or by email.</p>
    </LegalPage>
  );
}
