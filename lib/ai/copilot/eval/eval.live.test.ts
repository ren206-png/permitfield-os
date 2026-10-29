// Gate 6.7: runs the copilot evaluation set (cases.ts) against the real
// model. Opt-in and never in CI: it costs money and needs ANTHROPIC_API_KEY.
//   COPILOT_LIVE_PROVIDER=1 npx vitest run --config vitest.live.config.mts lib/ai/copilot/eval
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, test } from 'vitest';
import { runCopilotTurn } from '../orchestrator';
import { anthropicCopilotProvider } from '../provider';
import { EvidenceRegistry } from '../tools';
import { EVAL_CASES } from './cases';

describe.skipIf(process.env.COPILOT_LIVE_PROVIDER !== '1')('copilot evaluation set (live model)', () => {
  for (const c of EVAL_CASES) {
    test(`${c.id} -- ${c.covers}`, { timeout: 180_000 }, async () => {
      const result = await runCopilotTurn({
        provider: anthropicCopilotProvider(),
        tools: c.tools,
        ctx: {
          supabase: {} as SupabaseClient,
          scope: {
            userId: 'eval',
            orgId: 'eval',
            projectId: null,
            applicationId: 'eval',
            applicationTitle: 'Synthetic eval application',
            permitTypeId: 'eval',
            permitTypeTitle: 'Commercial tenant improvement',
            jurisdictionId: 'eval',
            jurisdictionName: 'Example Town, ON',
          },
          evidence: new EvidenceRegistry(),
          now: new Date(),
        },
        history: [],
        question: c.question,
      });
      const failures = c.check(result);
      if (failures.length) console.error(`EVAL ${c.id}: ${failures.join('; ')}\n  answer: ${result.answer}`);
      expect(failures).toEqual([]);
    });
  }
});
