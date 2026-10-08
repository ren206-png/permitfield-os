import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal/legal-page';
import { LEGAL_CONTACT_EMAIL, LEGAL_DISCLAIMER, LEGAL_ENTITY_NAME, LEGAL_GOVERNING_PROVINCE, PRODUCT_NAME } from '@/lib/brand';

export const metadata: Metadata = { title: `Terms of service | ${PRODUCT_NAME}` };

const contact = <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>;

export default function TermsPage() {
  return (
    <LegalPage title="Terms of service">
      <p>
        These terms are an agreement between you and {LEGAL_ENTITY_NAME} (&ldquo;we&rdquo;, &ldquo;us&rdquo;), which operates{' '}
        {PRODUCT_NAME}. By creating an account or using the service, you agree to them for yourself and for the organization you
        represent, and you confirm you are authorized to do so. Questions: {contact}.
      </p>

      <h2>Early access</h2>
      <p>
        {PRODUCT_NAME} is in early access. It is free to use during this period, and features may change, be added or be removed as
        it develops. Before we start charging for any part of the service, we will give account owners at least 30 days&apos;
        notice, and you can stop using it at any time.
      </p>

      <h2>The service</h2>
      <p>
        {PRODUCT_NAME} helps you organize permit applications, pre-fill official forms, track each authority&apos;s submission
        requirements, collect signatures, submit to permitting authorities, and manage estimates and invoices.
      </p>

      <h2>Not legal or code advice</h2>
      <p>{LEGAL_DISCLAIMER}</p>
      <ul>
        <li>
          AI extractions, findings and filled forms are suggestions. You are responsible for reviewing everything before it is
          signed or submitted, and for the accuracy and completeness of what you submit.
        </li>
        <li>
          Requirement checklists are compiled from authorities&apos; published material and may be incomplete or out of date.
          Authorities change their requirements and can ask for more. Check current requirements with the authority.
        </li>
        <li>
          You remain responsible for meeting professional requirements, such as using registered professionals and sealed
          drawings where the law requires them.
        </li>
        <li>
          Authorities decide whether to accept, approve or refuse an application, and how long it takes. We do not guarantee any
          outcome or timeline.
        </li>
      </ul>

      <h2>Submitting on your behalf</h2>
      <p>
        When you choose to submit an application, you authorize us to send it to the authority by email from our sending address,
        on your behalf and in your name, with replies directed to you. You confirm that you are authorized to apply for the
        property, including by its owner where that is required. Application and permit fees are yours to pay to the authority.
        We cannot recall a submission once it has been sent.
      </p>

      <h2>Your account and team</h2>
      <ul>
        <li>Keep your sign-in details secure. You are responsible for activity under your account and your organization.</li>
        <li>Owners control who is on their team and what each person can do.</li>
        <li>Provide accurate information, and only upload content you have the right to use.</li>
      </ul>

      <h2>Your content and your clients</h2>
      <p>
        You own the information and documents you put into the service. You give us permission to store, process and send them
        only as needed to provide the service to you, as described in our <a href="/privacy">privacy policy</a>.
      </p>
      <p>
        You are responsible for having the right to give us information about other people, such as clients, property owners and
        signers, and for telling them how it will be used. Estimates, invoices, reminders and other messages to your clients are
        sent at your direction, and you are responsible for having their permission to send them, including under Canada&apos;s
        anti-spam law.
      </p>

      <h2>Electronic signatures</h2>
      <p>
        Signers agree to sign electronically before they sign, and you are responsible for making sure the right person signs.
        Whether an authority accepts an electronic signature is up to that authority. The service offers e-signing for a permit
        form only where the authority has said it does.
      </p>

      <h2>Payments</h2>
      <p>
        Payments your clients make for your estimates and invoices are between you and your client. When online payments are
        available, they will be processed by Stripe under its own terms.
      </p>

      <h2>Acceptable use</h2>
      <p>
        Do not use the service to break the law, submit false or misleading information to an authority, send unwanted messages,
        upload malicious files, or try to access other organizations&apos; data or disrupt the service.
      </p>

      <h2>Availability and support</h2>
      <p>
        We work to keep the service available and your data safe, but we cannot promise it will be uninterrupted or error-free.
        You can ask us for a copy of your data at any time.
      </p>

      <h2>Suspension and ending your use</h2>
      <p>
        You can stop using the service at any time and ask us to close your account. We may suspend or close accounts that break
        these terms or put the service or other users at risk, and we will tell you why unless the law prevents it. When an account
        is closed, your data is handled as described in our privacy policy.
      </p>

      <h2>Disclaimers and liability</h2>
      <p>
        The service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. To the extent the law allows, we are not
        liable for indirect, incidental or consequential losses, lost profits, or decisions made by permitting authorities. Our
        total liability for any claim relating to the service is limited to the greater of the fees you paid us in the twelve
        months before the claim and CAD $100. Nothing in these terms limits liability that cannot be limited by law.
      </p>

      <h2>Indemnity</h2>
      <p>
        You agree to cover our reasonable losses from claims by others arising from the content you submit through the service, or
        from your breach of these terms.
      </p>

      <h2>Changes to these terms</h2>
      <p>
        We may update these terms. If a change is significant, we will tell account owners in the app or by email at least 30 days
        before it takes effect. Continuing to use the service after that means you accept the change.
      </p>

      <h2>Governing law</h2>
      <p>
        These terms are governed by the laws of the Province of {LEGAL_GOVERNING_PROVINCE} and the federal laws of Canada that apply
        there. Disputes will be heard by the courts of {LEGAL_GOVERNING_PROVINCE}.
      </p>
    </LegalPage>
  );
}
