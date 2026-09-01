// Gate AI-1, sub-phase AI-1.1 (GATE_AI_1_FINDINGS.md §A/§G). Pure,
// DB-independent task-kind -> {provider, modelId} router -- same
// "declared now, zero call sites yet" pattern as lib/entitlements/index.ts's
// can()/limit(), and the direct answer to the WRONG_MODEL adversarial
// scenario (GATE_AI_1_FINDINGS.md §H: "customer-facing request routed to
// Flash-Lite, or bulk classification routed to Pro"), which that findings
// pass found had no router to misroute through at all -- this file is that
// router, built from nothing, not a fix to an existing gap in one.
//
// GATE_AI_1_FINDINGS.md question 2's default (Ren: "use your default")
// governs this file's scope: the existing Claude-based
// lib/ai/extract-permit-data.ts / lib/ai/audit-permit-data.ts call sites are
// left untouched in this sub-phase. routeAiTask() therefore REJECTS
// 'extraction'/'audit' outright rather than silently returning some
// plausible-looking route for them -- a caller that tries to route either
// kind through here has misunderstood the current architecture, and should
// get a loud error, not a route to a model nothing has validated for that
// use case.
//
// isAiRoutingEnabled() (lib/flags.ts) gates nothing yet -- there is no
// caller for this module in this sub-phase. Declared now so the sub-phase
// that adds the first real caller (AI-1.3's classification job, or AI-1.4's
// assistant) only has to flip the flag on at its own call site, not invent
// this file.

import { GEMINI_ASSISTANT_MODEL_ID, GEMINI_CLASSIFICATION_MODEL_ID } from './config';
import { AiTaskKindSchema, type AiProvider, type AiTaskKind } from './schemas/ai-task';

export type { AiProvider, AiTaskKind } from './schemas/ai-task';

export interface AiTaskRoute {
  provider: AiProvider;
  modelId: string;
}

// Task kinds this router will actually route. Deliberately excludes
// 'extraction'/'audit' -- see this file's header. Record<..., AiTaskRoute>
// (rather than a plain object literal) so TypeScript itself enforces that
// every non-reserved AiTaskKind has an entry -- adding a new value to
// AiTaskKindSchema (lib/ai/schemas/ai-task.ts) without adding a route here
// is a compile error, not a silent runtime fallback.
type RoutableAiTaskKind = Exclude<AiTaskKind, 'extraction' | 'audit'>;

// *** PROVISIONAL model IDs -- see lib/ai/config.ts's header for why
// (PERMITFIELD_AI_MODEL_DECISION.md does not exist in this repo yet). ***
const TASK_ROUTES: Record<RoutableAiTaskKind, AiTaskRoute> = {
  assistant: { provider: 'gemini', modelId: GEMINI_ASSISTANT_MODEL_ID },
  classification: { provider: 'gemini', modelId: GEMINI_CLASSIFICATION_MODEL_ID },
  checklist_generation: { provider: 'gemini', modelId: GEMINI_ASSISTANT_MODEL_ID },
};

const RESERVED_KINDS: ReadonlySet<AiTaskKind> = new Set(['extraction', 'audit']);

/**
 * Resolves which provider/model a given AI-1 task kind should run against.
 * Pure and synchronous -- no DB, no env read beyond the constant lookups
 * already baked into lib/ai/config.ts, so this is unit-testable without any
 * live credential (see lib/ai/router.test.ts).
 *
 * Throws for 'extraction'/'audit' (see header) and for any kind
 * AiTaskKindSchema doesn't recognize -- fails closed rather than guessing a
 * route for an unknown task kind, same discipline as every fail-closed
 * pattern already established in lib/ai/extract-permit-data.ts /
 * lib/ai/audit-permit-data.ts.
 */
export function routeAiTask(kind: AiTaskKind): AiTaskRoute {
  const parsedKind = AiTaskKindSchema.parse(kind);

  if (RESERVED_KINDS.has(parsedKind)) {
    throw new Error(
      `routeAiTask('${parsedKind}') is not wired. This task kind stays on the existing Claude call sites ` +
        '(lib/ai/extract-permit-data.ts / lib/ai/audit-permit-data.ts) per GATE_AI_1_FINDINGS.md question 2\'s ' +
        'default -- do not route it through this adapter until that decision is explicitly revisited.'
    );
  }

  const route = TASK_ROUTES[parsedKind as RoutableAiTaskKind];
  if (!route) {
    throw new Error(`routeAiTask: no route configured for task kind '${parsedKind}'.`);
  }
  return route;
}
