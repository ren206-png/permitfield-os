-- Gate 5, sub-phase 5.3 hardening (post-ship, per Ren's explicit "1-4
-- matters to me please work on it" instruction). Additive only, per this
-- repo's standing migration convention.
--
-- notification_preferences: lets an individual org member opt OUT of the
-- application-lifecycle emails lib/inngest/functions/notify.ts sends
-- (GATE_5_FINDINGS.md §K/§F/§J.4's original sub-phase shipped with no
-- per-user control at all -- every org_members row was unconditionally
-- notified).
--
-- SHAPE DECISION: a separate table, NOT a column on org_members. org_members
-- already has an UPDATE policy (org_members_update, 20260806000002...sql),
-- but it is owner-gated (`using (is_org_owner(org_id))`) -- a plain member
-- could not flip their own opt-out flag if it lived there. This table gets
-- its own self-service RLS instead (below), scoped to `user_id = auth.uid()`
-- rather than org-owner-gated, so any member can manage their own
-- preference without needing the owner's help.
--
-- DEFAULT-ON, ABSENCE-MEANS-ENABLED: unlike this workstream's other new
-- tables, "no row exists yet" here does NOT mean "nothing happened" --
-- lib/notifications/recipients.ts's resolveOrgNotificationRecipients() must
-- treat a missing row as `email_enabled = true`. This is deliberate: every
-- org member who existed before this migration shipped, and every new
-- member who never visits the notification settings page, keeps getting
-- notified exactly as before -- opting out is an explicit, discoverable
-- action, never a silent behavior change on migration day.
create table notification_preferences (
  id uuid primary key default gen_random_uuid(),
  -- Composite-unique with user_id below, not a bare user_id primary key --
  -- a user's preference is scoped to one org's notifications, not global,
  -- mirroring every other per-(org, user) row shape in this schema (e.g.
  -- org_members itself).
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  -- No BEFORE UPDATE trigger maintains this -- confirmed zero such triggers
  -- exist anywhere in supabase/migrations/ (20260806000019's own header,
  -- reconfirmed by org_subscriptions, 20260806000040...sql). The settings
  -- page's own server action sets this explicitly on every write, same
  -- convention every other updated_at column in this schema already
  -- follows.
  updated_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create index notification_preferences_org_id_idx on notification_preferences (org_id);

alter table notification_preferences enable row level security;

-- Self-service, NOT org-owner-gated -- see this migration's own header
-- comment for why this deliberately does not mirror org_members_update's
-- is_org_owner() shape. `user_id = auth.uid()` alone is sufficient for
-- SELECT/UPDATE (a user only ever needs to see/change their OWN row), no
-- is_org_member() check needed there since the row can't identify any OTHER
-- user's preference regardless. INSERT additionally requires
-- is_org_member(org_id) -- not for this table's own safety (a stray row for
-- an org the user doesn't belong to is never read by anything, since
-- resolveOrgNotificationRecipients() only queries preferences for org_members
-- rows it already resolved), but so this table doesn't silently accumulate
-- nonsense (org_id, user_id) pairs that don't correspond to any real
-- membership.
create policy notification_preferences_select on notification_preferences
  for select to authenticated
  using (user_id = auth.uid());

create policy notification_preferences_insert on notification_preferences
  for insert to authenticated
  with check (user_id = auth.uid() and is_org_member(org_id));

create policy notification_preferences_update on notification_preferences
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- No DELETE policy -- deliberate default-deny, same "there is no legitimate
-- reason to delete this row" reasoning as every other lifecycle-record table
-- in this codebase. A user who wants notifications back on sets
-- email_enabled = true via the same UPDATE policy above; there is no
-- product reason to ever remove the row entirely.

-- Explicit grants only (20260806000015...sql's own convention).
grant select, insert, update on notification_preferences to authenticated;
-- service_role: SELECT only -- lib/notifications/recipients.ts's
-- resolveOrgNotificationRecipients() reads this table (as service_role,
-- inside the Inngest subscriber) to filter out opted-out members; it never
-- writes to this table (only the end user's own authenticated session does,
-- via the settings page's server action above).
grant select on notification_preferences to service_role;

-- Close the same Supabase-platform-default service_role TRUNCATE gap this
-- workstream's other new tables close proactively (20260806000033's lesson).
-- Harmless here in practice (service_role has no write grant to begin with),
-- applied anyway for the same "close it in the same migration that creates
-- the table, not by a future audit" discipline as every sibling table.
revoke truncate on notification_preferences from service_role;
