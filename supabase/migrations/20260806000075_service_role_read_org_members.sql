-- service_role reads org_members in background jobs: notification
-- recipients (lib/notifications/recipients.ts) and the owner-email fallback
-- for applicant.email when generating forms (lib/inngest/functions/
-- generate-pdf.ts). The hosted project already has this via platform-default
-- grants; newer local stacks (and CI) don't, so those paths failed only
-- locally. Grant it explicitly -- read only.
grant select on org_members to service_role;
