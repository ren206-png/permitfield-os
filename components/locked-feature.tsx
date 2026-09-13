// Gate 4 (Quotes & Payments), Phase A UI -- approximated component, flagged
// per this task's own rules: no "locked/upsell" UI pattern exists anywhere
// else in this codebase (grepped for entitlementCan|Upgrade|upsell across
// app/ and components/ before writing this -- app/(app)/projects/new/
// actions.ts's `entitlementCan(orgId, 'projects.create')` check is the only
// other entitlement call site, and it returns a plain `{error}` string
// rather than rendering any dedicated "locked" UI). This is a minimal,
// self-contained stand-in: a dashed-border card matching the existing
// "empty state" visual language (see e.g. app/(app)/applications/page.tsx's
// no-applications-yet block) rather than inventing a new visual idiom for
// one case.
export function LockedFeature({ title, message }: { title: string; message: string }) {
  return (
    <div className="mx-auto max-w-lg rounded-lg border border-dashed border-zinc-300 bg-white p-10 text-center">
      <h1 className="text-lg font-semibold text-zinc-900">{title}</h1>
      <p className="mt-2 text-sm text-zinc-600">{message}</p>
    </div>
  );
}
