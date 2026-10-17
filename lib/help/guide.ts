// The in-app help assistant answers only from this guide (see
// app/(app)/help-actions.ts). Keep it true to the product: when a feature
// changes, update the section here in the same PR, or the assistant will
// confidently describe the old behaviour.
//
// The iPhone app (ios/, capacitor.config.ts) isn't on the App Store yet, so
// the guide covers the website only. When it is released, add back: sign in
// with email or "Continue with Apple" (Google and Microsoft are web-only),
// and "Scan with camera" on an application's Documents panel.
export const HELP_GUIDE = `# PermitField OS: how the app works

PermitField OS helps Canadian contractors prepare commercial permit applications: it reads your drawings and documents, fills in the city's own application form, builds that city's submission checklist, collects signatures, and records or sends the submission. It is a filing assistant, not legal or building-code advice; the contractor is responsible for what is submitted, and for sealed drawings where a registered professional is required.

## Cities and permit types covered

Commercial tenant improvement permits in: Calgary AB, Edmonton AB, Vancouver BC, Surrey BC, Richmond BC, Coquitlam BC, Port Coquitlam BC, Maple Ridge BC, Ottawa ON, Hamilton ON and Toronto ON. Toronto also has electrical service upgrades (filed with the Electrical Safety Authority, ESA).

How each is submitted:
- Email from PermitField (form and documents attached): Surrey, Richmond, and ESA (Toronto electrical service upgrades). Surrey also asks how you'll pay the permit fee.
- The city's own online portal: Vancouver, Coquitlam, Maple Ridge, Calgary, Edmonton (selfserve.edmonton.ca), Ottawa (My ServiceOttawa), Hamilton, Toronto. File on the portal yourself, then record the submission in PermitField with the city's reference number.
- In person: Port Coquitlam.

Calgary has no PDF application form: instead of a filled form, the application shows a "portal answer sheet" with every answer ready to copy into Calgary's online portal. Other portal cities also get the answer sheet alongside the filled form.

Cities or permit types not listed aren't supported yet; customers can ask for them by email.

## Getting started

1. Create an account at www.permitfieldos.com: "Create your account", then email and password (at least 10 characters), or "Continue with Google" or "Continue with Microsoft". Email sign-ups confirm their address from a link in an email. PermitField is a website only for now (www.permitfieldos.com): there is no phone app yet. The sign-in page has a short "Verify you are human" check from Cloudflare.
2. Set up the company: company name, then the contractor company, licence number and province that go on permit forms.
3. Invite teammates in Team (sidebar).

## Starting an application

Applications (sidebar) -> New application. Pick the city and permit type, the contractor, a project title, the full project address (include the unit number, e.g. "Unit 500, 1030 W Georgia Street"), and the estimated job value. Click "Create application".

## Uploading documents

On the application page, under Documents: choose the files, pick the document type (Blueprint for drawings, Scope of work, Spec sheet, or Other) and click Upload. Accepted: PDF, JPEG, PNG, TIFF; up to 25 MB per file and 100 MB per application. Upload drawings, scope of work and specs; on the LAST file, tick "This is my last upload for now -- start AI extraction" before clicking Upload. If you forget, upload one more file with the box ticked. Found a missing drawing after the AI has run? Upload it with the box ticked and the AI reads all the documents again and refills the form. This works until a form is signed or the application is submitted; after that the file is saved but the form isn't refilled, and the page says so.

## What happens next (AI extraction and the filled form)

Within about a minute PermitField reads the documents, shows an "Extraction summary" (each field with a confidence score), fills in the city's form and adds the city's checklist. For Toronto and Calgary there is an extra AI compliance review step first: when it says the application is ready for review, check the findings and click "Confirm review" to generate the form.

Always click "Download filled form" and check every field against the drawings and contract: the filling is done by AI and can be wrong.

## Signatures

The Signatures panel on the application page:
- Vancouver accepts electronic signatures: enter the signer's name and email and click "Send for signature". The signer gets an email with a link, reviews the filled form, types or draws a signature and clicks "Sign the form". The signed copy replaces the unsigned one and is what gets submitted. You can cancel a pending request or send a new link.
- Every other city: print the form, sign by hand, scan it, and use "Upload signed copy" (PDF) in the same panel.

## The checklist and "Permit progress"

The "Permit progress" panel holds the permit's status and the city's checklist. Each item says whether it is required, and items checked by our team show "Verified by PermitField". Items marked optional only apply if the job triggers them (for example food service or strata property). Each item links to the city's own requirements page. Mark items complete as you gather them; you can also add your own items.

Required items must be complete before the status can move to "Ready to submit". Owners and permit managers can record an override with a written reason (kept permanently on the application).

Statuses, in order: Intake, Requirements review, Collecting documents, Internal review, Ready to submit, then Submitted, Under municipal review, Revision requested, Resubmitted, Approved, Issued (also Rejected, Appeal filed, Withdrawn, Expired, Closed). Choose the next status and click "Update status".

## Submitting

In the submission panel on the application page:
- Email cities (Surrey, Richmond, ESA): click the "Email to ..." button. The form and documents are attached (up to about 28 MB), you get a copy, and the city replies to you directly.
- Portal and in-person cities: file with the city, then record the submission with the city's reference number.

Only owners and permit managers can submit.

## After submitting

Update the status as the city responds. When the permit is issued, enter its expiry date on the application to get an email reminder before it lapses. Notifications (sidebar) lists alerts.

## Team, roles and security

Team (sidebar): owners invite people by email and choose a role: Owner, Permit manager, Permit coordinator or Member. Owners and permit managers can submit filings and upload signed forms; coordinators and members prepare applications. A person can belong to several companies and switch between them.

Security (sidebar): set up two-factor sign-in with an authenticator app. API keys (sidebar, owners only): read-only access to projects and applications for other software.

Forgot password: on the sign-in page click "Forgot password?" under the password box, enter the account email and click "Send reset link". The email's link works for 1 hour on any device: open it, click Continue, then choose a new password (at least 10 characters; passwords found in known data breaches are refused). Signed-in users can change their password from Security (sidebar) -> "Change password". People who sign in with Google or Microsoft manage their password with that provider. If the reset email doesn't arrive (check spam), email support. Deleting an account: Security (sidebar) -> "Delete account", type DELETE and confirm. It permanently removes the person's sign-in and details; if they're the only member of their company, the company and all its applications, documents and files are deleted too. In a shared company the records stay with the company, and the only owner must first make someone else an owner in Team. It can't be undone.

## Estimates and invoices

Clients, Estimates, Invoices and Tax profile (sidebar) let a contractor send quotes and invoices to their own clients by secure link. Add a client first, then create an estimate or invoice for them.

## Pricing and data

PermitField is free during early access; customers get at least 30 days' notice before any charge and can stop at any time. Billing (sidebar) shows the current plan and the prices once paid plans start: Starter CA$149/month (up to 10 active applications), Pro CA$499/month (up to 50, plus the AI compliance check and API), or CA$79 per application. The first 10 companies to sign up are founding customers with 25% off for as long as they keep a paid plan; the Billing page says if a company is one. There is no payment form yet. Only the customer's own company sees its applications. Data is stored with providers in the United States, is never sold, and goes to a city only when the customer submits. Privacy policy: www.permitfieldos.com/privacy. Terms: www.permitfieldos.com/terms.
`;
