import { PROJECT_STATUS_LABELS, type ProjectStatus } from '@/lib/dashboard/labels';

// Mirrors status-badge.tsx's own literal-union + label-map shape (that
// file's header comment explains why: a new `project_status` enum value
// added in a migration fails this component at compile time via the `never`
// catch below, rather than silently rendering the raw enum string). Reuses
// lib/dashboard/labels.ts's own ProjectStatus type/labels rather than
// redeclaring a third copy of the same 5-value enum.
const STATUS_CLASSES: Record<ProjectStatus, string> = {
  draft: 'bg-zinc-100 text-zinc-700',
  active: 'bg-blue-100 text-blue-700',
  on_hold: 'bg-amber-100 text-amber-700',
  completed: 'bg-green-100 text-green-700',
  archived: 'bg-zinc-200 text-zinc-500',
};

export function ProjectStatusBadge({ status }: { status: string }) {
  const known = status as ProjectStatus;
  const label = PROJECT_STATUS_LABELS[known] ?? status;
  const classes = STATUS_CLASSES[known] ?? 'bg-zinc-100 text-zinc-700';

  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${classes}`}>
      {label}
    </span>
  );
}
