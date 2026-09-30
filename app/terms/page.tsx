import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal/legal-page';
import { LEGAL_CONTACT_EMAIL, LEGAL_DISCLAIMER, PRODUCT_NAME } from '@/lib/brand';

export const metadata: Metadata = { title: `Terms of service | ${PRODUCT_NAME}` };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of service">
      <p>
        These terms govern your use of {PRODUCT_NAME}. By creating an account or using the service you agree to them on behalf of
        yourself and the organization you represent. Questions: <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>.
      </p>

      <h2>The service</h2>
      <p>
        {PRODUCT_NAME} helps you organize permit applications, pre-fill official forms, collect electronic signatures, submit to
        permitting authorities, and manage estimates, invoices and payments. Features may change as the service develops.
      </p>

      <h2>Not legal or code advice</h2>
      <p>{LEGAL_DISCLAIMER}</p>
      <p>
        AI-generated extractions, findings and filled forms are suggestions. You are responsible for reviewing everything before
        it is signed or submitted, and for the accuracy of what you submit to any authority.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>Keep your sign-in details secure; you are responsible for activity under your account and your organization.</li>
        <li>Owners control who is on their team and what role each person has.</li>
        <li>Provide accurate information, and only upload content you have the right to use.</li>
      </ul>

      <h2>Your content</h2>
      <p>
        You own the information and documents you put into the service. You give us permission to store and process them only as
        needed to provide the service to you, including sending them to the service providers described in our{' '}
        <a href="/privacy">privacy policy</a> and to authorities or signers when you ask us to.
      </p>

      <h2>Acceptable use</h2>
      <p>
        Don&apos;t use the service to break the law, submit false information to an authority, send unwanted messages, or try to
        access other organizations&apos; data or disrupt the service.
      </p>

      <h2>Electronic signatures</h2>
      <p>
        Signers agree to sign electronically before they sign. Whether an authority accepts an electronic signature is up to that
        authority; the service offers e-signing only where an authority has said it does.
      </p>

      <h2>Fees</h2>
      <p>
        Paid plans, if any, are billed through Stripe at the prices shown when you subscribe. Payments your clients make to you
        through the service are between you and your client.
      </p>

      <h2>Availability and changes</h2>
      <p>
        We work to keep the service available and your data safe, but we can&apos;t promise it will be uninterrupted or error-free.
        We may update these terms; continued use after an update means you accept it.
      </p>

      <h2>Disclaimers and liability</h2>
      <p>
        The service is provided &ldquo;as is&rdquo;. To the extent the law allows, we are not liable for indirect or consequential
        losses, or for decisions made by permitting authorities, and our total liability is limited to the fees you paid us in the
        twelve months before the claim.
      </p>

      <h2>Ending your use</h2>
      <p>
        You can stop using the service at any time and ask us to delete your account. We may suspend accounts that break these
        terms.
      </p>

      <h2>Governing law</h2>
      <p>These terms are governed by the laws applicable in Canada.</p>
    </LegalPage>
  );
}
