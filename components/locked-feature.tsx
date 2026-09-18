// No "locked/upsell" UI pattern existed anywhere in this codebase before
// this (grepped entitlementCan|Upgrade|upsell across app/ and components/
// -- the only other entitlement call site, projects/new/actions.ts's
// `can(orgId, 'projects.create')`, returns a plain `{error}` string with no
// dedicated "locked" UI). This is a minimal, self-contained stand-in: a
// dashed-border card matching this codebase's existing "empty state" visual
// language (see e.g. app/(app)/applications/page.tsx's no-applications-yet
// block) rather than inventing a new visual idiom for one case.
export function LockedFeature({ title, message }: { title: string; message: string }) {
  return (
    <div className="mx-auto max-w-lg rounded-lg border border-dashed border-zinc-300 bg-white p-10 text-center">
      <h1 className="text-lg font-semibold text-zinc-900">{title}</h1>
      <p className="mt-2 text-sm text-zinc-600">{message}</p>
    </div>
  );
}
