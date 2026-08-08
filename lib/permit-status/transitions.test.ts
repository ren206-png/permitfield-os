import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ALL_PERMIT_STATUSES,
  PERMIT_STATUS_TIER,
  PERMIT_STATUS_TRANSITIONS,
  ORG_TIER_ROLES,
  SUBMISSION_TIER_ROLES,
  JURISDICTION_OUTCOME_TIER_ROLES,
  isValidPermitStatusTransition,
  canRoleTransitionTo,
  permitStatusTier,
  type PermitStatus,
  type PermitStatusRole,
} from './transitions';

// Lifecycle & Compliance Expansion, Phase 1.3. This repo's second
// pure-TS-mirror-of-SQL-logic module (after lib/jurisdictions/staleness.ts,
// Phase 1.2) and, like that one, framework-free -- no DB, no Next.js -- so
// these tests exercise the exact same code a future route/UI would call,
// with no environment gap. See this module's own header comment for why the
// duplication exists at all.

describe('ALL_PERMIT_STATUSES / PERMIT_STATUS_TIER — exactly 16 statuses, every one tiered', () => {
  it('has exactly 16 statuses, matching the master prompt\'s 16-status spec', () => {
    expect(ALL_PERMIT_STATUSES).toHaveLength(16);
  });

  it('has no duplicate statuses', () => {
    expect(new Set(ALL_PERMIT_STATUSES).size).toBe(16);
  });

  it('every status in ALL_PERMIT_STATUSES has a PERMIT_STATUS_TIER entry, and vice versa', () => {
    for (const status of ALL_PERMIT_STATUSES) {
      expect(PERMIT_STATUS_TIER[status]).toBeDefined();
    }
    expect(Object.keys(PERMIT_STATUS_TIER).sort()).toEqual([...ALL_PERMIT_STATUSES].sort());
  });

  it('tiers are exactly as documented: 6 org, 2 submission, 8 jurisdiction_outcome', () => {
    const counts = { org: 0, submission: 0, jurisdiction_outcome: 0 };
    for (const status of ALL_PERMIT_STATUSES) {
      counts[PERMIT_STATUS_TIER[status]]++;
    }
    expect(counts).toEqual({ org: 6, submission: 2, jurisdiction_outcome: 8 });
  });
});

describe('isValidPermitStatusTransition', () => {
  it('accepts the one legal "new application" edge: null -> intake', () => {
    expect(isValidPermitStatusTransition(null, 'intake')).toBe(true);
  });

  it('rejects null -> any other status', () => {
    for (const status of ALL_PERMIT_STATUSES) {
      if (status === 'intake') continue;
      expect(isValidPermitStatusTransition(null, status)).toBe(false);
    }
  });

  it('accepts every edge declared in PERMIT_STATUS_TRANSITIONS and rejects every undeclared pair', () => {
    for (const status of ALL_PERMIT_STATUSES) {
      const legalTargets = new Set(PERMIT_STATUS_TRANSITIONS[status]);
      for (const target of ALL_PERMIT_STATUSES) {
        expect(isValidPermitStatusTransition(status, target)).toBe(legalTargets.has(target));
      }
    }
  });

  it('closed and withdrawn are terminal — no outgoing transitions at all', () => {
    for (const terminal of ['closed', 'withdrawn'] as PermitStatus[]) {
      for (const target of ALL_PERMIT_STATUSES) {
        expect(isValidPermitStatusTransition(terminal, target)).toBe(false);
      }
    }
  });

  it('a status is never its own legal next state (no accidental self-loops)', () => {
    for (const status of ALL_PERMIT_STATUSES) {
      expect(isValidPermitStatusTransition(status, status)).toBe(false);
    }
  });
});

describe('canRoleTransitionTo — mirrors transition_permit_status()\'s "Check 2"', () => {
  const orgOnlyRoles: PermitStatusRole[] = ['document_reviewer', 'client_user', 'auditor_readonly'];

  it('org tier: every ORG_TIER_ROLES role can, every other declared role cannot', () => {
    for (const status of ALL_PERMIT_STATUSES.filter((s) => permitStatusTier(s) === 'org')) {
      for (const role of ORG_TIER_ROLES) {
        expect(canRoleTransitionTo(role, status)).toBe(true);
      }
      for (const role of orgOnlyRoles) {
        expect(canRoleTransitionTo(role, status)).toBe(false);
      }
    }
  });

  it('submission tier: only permit_manager and above', () => {
    for (const status of ALL_PERMIT_STATUSES.filter((s) => permitStatusTier(s) === 'submission')) {
      for (const role of SUBMISSION_TIER_ROLES) {
        expect(canRoleTransitionTo(role, status)).toBe(true);
      }
      // In ORG_TIER_ROLES but NOT SUBMISSION_TIER_ROLES: member,
      // permit_coordinator, applicant_contractor -- the whole point of this
      // tier split (a role that can do org-side work cannot, by itself,
      // hand the application to the jurisdiction).
      for (const role of ['member', 'permit_coordinator', 'applicant_contractor'] as PermitStatusRole[]) {
        expect(canRoleTransitionTo(role, status)).toBe(false);
      }
    }
  });

  it('jurisdiction_outcome tier: only permit_coordinator and above', () => {
    for (const status of ALL_PERMIT_STATUSES.filter((s) => permitStatusTier(s) === 'jurisdiction_outcome')) {
      for (const role of JURISDICTION_OUTCOME_TIER_ROLES) {
        expect(canRoleTransitionTo(role, status)).toBe(true);
      }
      // applicant_contractor is exactly the role the migration's header
      // comment calls out by name: letting it set 'issued' would make the
      // column an unauditable self-attestation.
      for (const role of ['member', 'applicant_contractor'] as PermitStatusRole[]) {
        expect(canRoleTransitionTo(role, status)).toBe(false);
      }
    }
  });
});

describe('cross-check against docs/STATUS_TRANSITIONS.md\'s authoritative edge-list table', () => {
  // Same drift-prevention discipline as lib/authz/permissions-doc.test.ts:
  // parses the markdown table out of the doc on disk and diffs it against
  // this module's live PERMIT_STATUS_TRANSITIONS map, so a doc/code
  // disagreement is a failing test, not a stale doc nobody notices.
  const docPath = join(__dirname, '..', '..', 'docs', 'STATUS_TRANSITIONS.md');
  const contents = readFileSync(docPath, 'utf-8');

  function parseEdgeListTable(): Map<string, string[]> {
    const lines = contents.split('\n');
    const headerIndex = lines.findIndex((line) => line.trim().startsWith('| From |'));
    if (headerIndex === -1) {
      throw new Error(`Could not find the edge-list table header ("| From | ...") in ${docPath}.`);
    }

    const table = new Map<string, string[]>();
    for (let i = headerIndex + 2; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line.startsWith('|')) break;

      const cells = line
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((c) => c.trim());
      const [fromCell, toCell] = cells;

      const fromKey = fromCell.includes('new application') ? 'null' : (fromCell.match(/`([^`]+)`/)?.[1] ?? fromCell);
      const toValues = toCell.includes('terminal') ? [] : [...toCell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

      table.set(fromKey, toValues);
    }
    return table;
  }

  const docTable = parseEdgeListTable();

  it('the doc table has a row for null (new application) and every PermitStatus', () => {
    expect(docTable.has('null')).toBe(true);
    for (const status of ALL_PERMIT_STATUSES) {
      expect(docTable.has(status), `docs/STATUS_TRANSITIONS.md is missing a row for "${status}"`).toBe(true);
    }
  });

  it('every row\'s legal next-states match PERMIT_STATUS_TRANSITIONS exactly', () => {
    for (const [from, toValues] of docTable.entries()) {
      const expected = PERMIT_STATUS_TRANSITIONS[from as PermitStatus | 'null'];
      expect(
        [...toValues].sort(),
        `docs/STATUS_TRANSITIONS.md row "${from}" lists [${toValues.join(', ')}] but ` +
          `PERMIT_STATUS_TRANSITIONS['${from}'] is [${expected.join(', ')}]. Update whichever one is stale.`
      ).toEqual([...expected].sort());
    }
  });
});
