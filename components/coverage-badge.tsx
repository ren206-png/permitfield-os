// Mirrors README's "Coverage tiers" section verbatim -- this badge is the
// single most safety-critical piece of UI in the product. It must appear
// everywhere a jurisdiction is shown, and its wording must never let a
// contractor read `assisted`/`listed` as "reviewed and clean" (see
// README: "the single most likely way this product injures a customer").
type CoverageLevel = 'verified' | 'assisted' | 'listed';

const COVERAGE_LABELS: Record<CoverageLevel, string> = {
  verified: 'Verified coverage',
  assisted: 'Assisted — AI audit off',
  listed: 'Listed only — not yet covered',
};

const COVERAGE_CLASSES: Record<CoverageLevel, string> = {
  verified: 'bg-emerald-100 text-emerald-700',
  assisted: 'bg-amber-100 text-amber-700',
  listed: 'bg-zinc-200 text-zinc-700',
};

export function CoverageBadge({ coverageLevel }: { coverageLevel: string }) {
  const known = coverageLevel as CoverageLevel;
  const label = COVERAGE_LABELS[known] ?? coverageLevel;
  const classes = COVERAGE_CLASSES[known] ?? 'bg-zinc-200 text-zinc-700';

  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${classes}`}>
      {label}
    </span>
  );
}
