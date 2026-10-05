-- Surrey, BC: file by email, not portal.
--
-- Surrey's "Digital Submission Guide" (checked 2026-10-04) says "All complete
-- application packages can be submitted by email to permitapplication@surrey.ca";
-- the permitting portal only takes single-family subdivision applications (for
-- commercial permits it is for viewing status, fees and inspections). Surrey's
-- tenant and landlord improvement checklist (July 2025) also ends "Email
-- permitapplication@surrey.ca your complete application package". Migration
-- 068 had recorded 'portal'.
--
-- Surrey's email rules are stricter than Richmond's PL-59, so two per-authority
-- switches are added:
--   submission_attachments_only -- every document goes as its own PDF
--     attachment in the one email; "downloadable links or multiple documents
--     in one PDF are not accepted". Richmond keeps its file-sharing links.
--   submission_payment_method_required -- the email body must state the
--     method of payment, so the submitter has to say how they'll pay.
-- Subject "<project address>, <type of application>" already matches what
-- lib/submissions/email.ts sends.

alter table authorities
  add column submission_attachments_only boolean not null default false,
  add column submission_payment_method_required boolean not null default false;

update authorities set
  filing_mechanism = 'pdf_email',
  submission_email = 'permitapplication@surrey.ca',
  submission_email_source_url = 'https://www.surrey.ca/renovating-building-development/digital-submission-guide',
  submission_email_verified_on = '2026-10-04',
  submission_attachments_only = true,
  submission_payment_method_required = true,
  submission_instructions = 'Surrey takes one application per email, with every required document as its own unlocked PDF attachment (no links or zip files), including the completed Tenant & Landlord Improvement checklist. Sealed drawings need a Notarius digital seal and signature, with each discipline''s drawings in a single PDF. For packages too large to email, call Surrey''s Client Services Centre at 604-591-4086.'
where id = '00000000-0000-0000-0002-000000000004';
