// Gate 6.4 exit evidence: ONE live-provider test, kept apart from the
// mocked ones (orchestrator.test.ts) as master prompt §17 N.4 asks. It runs
// the real orchestrator against the real model (claude-sonnet-5-5) with
// stand-in tools -- no database -- to prove the request shape the adapter
// sends is accepted (strict tool schemas, adaptive thinking, effort,
// server-side fallback), that the model calls a tool with valid
// arguments, and that it finishes through give_answer with a citation the
// validator accepts.
//
// Costs real money (a few cents), so it is opt-in and never runs in CI:
//   COPILOT_LIVE_PROVIDER=1 npx vitest run --config vitest.live.config.mts lib/ai/copilot/provider.live.test.ts
// Needs ANTHROPIC_API_KEY (read from .env.local by vitest.live.setup.ts).
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import type { EvidenceItem } from '@/lib/sources/evidence';
import { runCopilotTurn } from './orchestrator';
import { anthropicCopilotProvider } from './provider';
import { EvidenceRegistry, type CopilotTool } from './tools';

const passage: EvidenceItem = {
  evidenceId: 'S1',
  kind: 'official_source',
  content:
    'Interior alterations to a commercial unit require a building permit. Submit a floor plan drawn to scale showing existing and proposed walls.',
  locator: 'Building permits › Interior alterations',
  sourceRevisionId: 'rev-live-test',
  sourceId: 'src-live-test',
  sourceType: 'forms_page',
  url: 'https://example.test/permits',
  title: 'Interior alterations',
  issuingBody: 'Test City',
  revisionNumber: 1,
  publishedOn: null,
  effectiveFrom: null,
  effectiveTo: null,
  retrievedAt: '2026-10-01T00:00:00Z',
  accessScope: 'public',
  lastCheckedAt: '2026-10-27T00:00:00Z',
  freshness: 'fresh',
};

const search: CopilotTool = {
  name: 'search_permit_sources',
  description: 'Full-text search of the official sources for this municipality. Returns passages with evidence ids to cite.',
  input: z.strictObject({ query: z.string().trim().min(2).max(300) }),
  async run(ctx) {
    const [item] = ctx.evidence.add([passage]);
    return { ok: true, data: { results: [{ evidence_id: item.evidenceId, title: passage.title, locator: item.locator, text: item.content }] } };
  },
};

describe.skipIf(process.env.COPILOT_LIVE_PROVIDER !== '1')('copilot against the live model', () => {
  test('calls a tool with valid arguments and answers through give_answer with a checked citation', { timeout: 150_000 }, async () => {
    const result = await runCopilotTurn({
      provider: anthropicCopilotProvider(),
      tools: [search],
      ctx: {
        supabase: {} as SupabaseClient,
        scope: {
          userId: 'u',
          orgId: 'o',
          projectId: null,
          applicationId: 'a',
          applicationTitle: 'Unit 4 fit-out',
          permitTypeId: 't',
          permitTypeTitle: 'Commercial tenant improvement',
          jurisdictionId: 'j',
          jurisdictionName: 'Test City, ON',
        },
        evidence: new EvidenceRegistry(),
        now: new Date(),
      },
      history: [],
      question: 'What drawing does the city want for interior alterations? Search the official sources and cite them.',
    });
    console.log(JSON.stringify({ stoppedBecause: result.stoppedBecause, usage: result.usage, tools: result.toolCalls.map((t) => [t.name, t.status]), citations: result.citations.length, rejected: result.rejectedCitations }, null, 2));
    expect(result.toolCalls.some((t) => t.name === 'search_permit_sources' && t.status === 'succeeded')).toBe(true);
    expect(result.stoppedBecause).toBe('answered');
    expect(result.answer).toBeTruthy();
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.citations[0].evidence).toMatchObject({ sourceRevisionId: 'rev-live-test' });
  });
});
