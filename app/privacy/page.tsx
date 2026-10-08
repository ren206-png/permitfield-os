import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal/legal-page';
import { LEGAL_CONTACT_EMAIL, LEGAL_ENTITY_NAME, LEGAL_GOVERNING_PROVINCE, PRODUCT_NAME } from '@/lib/brand';

export const metadata: Metadata = { title: `Privacy policy | ${PRODUCT_NAME}` };

const contact = <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>;

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy">
      <p>
        {PRODUCT_NAME} is operated by {LEGAL_ENTITY_NAME} (&ldquo;we&rdquo;, &ldquo;us&rdquo;), a company based in{' '}
        {LEGAL_GOVERNING_PROVINCE}, Canada. It helps trade contractors prepare, sign and submit permit applications, and manage
        estimates and invoices. This policy explains what personal information we handle, why, who helps us process it, and the
        choices you have.
      </p>

      <h2>Who is accountable</h2>
      <p>
        Our Privacy Officer is responsible for how we handle personal information and for answering questions and requests. Reach
        them at {contact}.
      </p>
      <p>
        For information about you, your organization and your team, we decide how it is used, as this policy describes. For
        information about other people that you put into the service (your clients, property owners, signers, and people named in
        your documents), we handle it on your behalf to provide the service to you. You are responsible for having the right to
        share it with us and for telling those people how it will be used.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li>
          <strong>Account information:</strong> your name and email address, and your password (stored only as a secure hash). If
          you sign in with Google or Microsoft, we receive your name and email address from them, never your password. If you turn
          on two-factor sign-in, we store what is needed to check your codes.
        </li>
        <li>
          <strong>Organization and team:</strong> your company details, licence details, the people you invite and their roles.
        </li>
        <li>
          <strong>Project and application data:</strong> project addresses and descriptions, documents and drawings you upload, the
          permit forms the service fills in, and the status of each application. Forms and documents often include the names and
          contact details of property owners and other people.
        </li>
        <li>
          <strong>Your clients&apos; information:</strong> names, email addresses and other details you enter for estimates,
          invoices, change orders and client links.
        </li>
        <li>
          <strong>Electronic signatures:</strong> the typed or drawn signature, the signer&apos;s name and email, the consent they
          gave, the time, IP address and browser, and a fingerprint of the signed document, kept as a record of the signature.
        </li>
        <li>
          <strong>Technical information:</strong> logs, IP addresses and device details, kept to run and secure the service.
        </li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To provide the service: fill in permit forms, review documents, collect signatures, and keep your records.</li>
        <li>
          To process documents with AI: document text is sent to our AI providers to extract information, flag issues and make
          documents searchable. Results are suggestions for you to review, not legal or code advice. We do not use your documents
          to train our own AI models.
        </li>
        <li>
          To send the emails you ask for: submissions to permitting authorities, signature requests, estimates, invoices and
          reminders to your clients, and team invitations. We also send service emails such as sign-up confirmations, password resets and security
          notices. We do not send you marketing email without your consent.
        </li>
        <li>To keep accounts secure, prevent abuse, fix problems, and meet our legal obligations.</li>
      </ul>
      <p>We do not sell personal information, and we do not use it for advertising.</p>

      <h2>Who we share it with</h2>
      <p>These providers process information only to deliver the service, under agreements that limit how they may use it:</p>
      <ul>
        <li>Supabase: database, file storage and sign-in (United States, Oregon region).</li>
        <li>Vercel: website hosting, and cookie-free visitor statistics on our public home page.</li>
        <li>Anthropic: AI reading and review of document text.</li>
        <li>Voyage AI: AI search indexing of document text.</li>
        <li>Resend: sending email.</li>
        <li>Inngest: running background tasks such as form generation.</li>
        <li>Stripe: payments, once online payments are available.</li>
        <li>Google and Microsoft: only if you choose to sign in with them.</li>
      </ul>
      <p>We also share information when you ask us to:</p>
      <ul>
        <li>
          <strong>Permitting authorities:</strong> when you submit an application, we send the forms and documents you choose to the
          authority. From then on, the authority holds them under its own rules and laws. Some authorities publish application
          details or make them available to the public.
        </li>
        <li>
          <strong>Signers and your clients:</strong> when you send something to sign, an estimate, an invoice or a client link.
        </li>
      </ul>
      <p>
        We may also disclose information when the law requires it, or as part of a sale or reorganization of our business, in which
        case this policy continues to apply to it.
      </p>

      <h2>Where your information is stored</h2>
      <p>
        Our providers store and process information in the United States and other countries outside Canada. While it is there, it
        is subject to the laws of those countries, and their courts and authorities may be able to access it.
      </p>

      <h2>How we protect it</h2>
      <p>
        Information is encrypted in transit and at rest. Each organization&apos;s data is kept separate by access rules enforced in
        the database. Two-factor sign-in is available, and access by our own staff is limited to what is needed to run and support
        the service. If a breach of security creates a real risk of significant harm, we will notify the people affected and the
        privacy commissioners as the law requires.
      </p>

      <h2>How long we keep it</h2>
      <p>
        We keep your information while your account is active. If you close your account, we delete or anonymize your information
        within 90 days, except for records we need to keep: records of signatures and submissions are kept as evidence of what was
        signed and sent, and some information is kept longer where the law requires it. Backup copies are replaced on a rolling
        basis.
      </p>

      <h2>Your choices and rights</h2>
      <p>
        You can see and update most of your information in the app. You can ask for a copy of your personal information, ask us to
        correct it, or withdraw consent to a use of it, by emailing {contact}. We will answer within 30 days. Withdrawing consent
        may mean we can no longer provide parts of the service.
      </p>
      <p>
        If you are not satisfied with our answer, you can contact the Office of the Information and Privacy Commissioner of Alberta,
        the Office of the Privacy Commissioner of Canada, or the privacy commissioner in your province.
      </p>

      <h2>Cookies and browser storage</h2>
      <p>
        We use only the cookies needed to keep you signed in and remember which organization you are working in. Our public home
        page also stores your light or dark display choice in your browser. Its visitor statistics do not use cookies. We do not
        use advertising or tracking cookies.
      </p>

      <h2>Children</h2>
      <p>The service is for businesses and is not directed to children.</p>

      <h2>Changes</h2>
      <p>
        We will post any changes here and update the date above. If a change is significant, we will tell account owners in the app
        or by email before it takes effect.
      </p>
    </LegalPage>
  );
}
