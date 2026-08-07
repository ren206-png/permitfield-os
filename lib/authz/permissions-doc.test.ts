import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ALL_ROLES,
  ALL_RESOURCES,
  formatPermissionCell,
  type Role,
  type Resource,
} from './index';

// Lifecycle & Compliance Expansion, Phase 1.1 gap follow-up (self-check
// items 8/9): docs/PERMISSIONS.md's Table 2 is hand-written prose that
// "reproduces" this module's `can()` matrix for readability (see that
// doc's own header comment above the table). Hand-written means it can
// drift silently from the matrix any time someone edits one without the
// other. This test closes that gap by parsing Table 2 straight out of the
// markdown file on disk and diffing every (role, resource) cell against
// formatPermissionCell()'s live computation from `matrix` -- so a drift is
// a failing test, not a stale doc nobody notices.
//
// This does NOT validate that Table 2 (or the matrix) is *correct* against
// real RLS policy -- that's Table 1's job, and lib/authz/index.test.ts's
// "legacy roles mirror current RLS reality" describe block. This test only
// proves the two representations of the *same* aspirational model
// (matrix vs. its markdown transcription) agree with each other.

const PERMISSIONS_DOC_PATH = join(__dirname, '..', '..', 'docs', 'PERMISSIONS.md');

// Splits one markdown table row into its cells, preserving blank interior
// cells (a blank cell is meaningful data -- "no access" -- not parsing
// noise to be filtered out). Only the leading/trailing empty strings
// produced by the row's own outer `|` characters are dropped.
function splitTableRow(line: string): string[] {
  const trimmed = line.trim();
  const inner = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  return inner.split('|').map((cell) => cell.trim());
}

function parseTable2(): Map<Role, Map<Resource, string>> {
  const contents = readFileSync(PERMISSIONS_DOC_PATH, 'utf-8');
  const lines = contents.split('\n');

  const headerIndex = lines.findIndex((line) => line.trim().startsWith('| Role |'));
  if (headerIndex === -1) {
    throw new Error(
      `Could not find Table 2's header row ("| Role | ...") in ${PERMISSIONS_DOC_PATH}. ` +
        'Has the table been renamed or restructured?'
    );
  }

  const headerCells = splitTableRow(lines[headerIndex]);
  const resourceColumns = headerCells.slice(1); // drop the leading "Role" column

  // headerIndex + 1 is the `|---|---|...` separator row; data starts after it.
  const table = new Map<Role, Map<Resource, string>>();
  for (let i = headerIndex + 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim().startsWith('|')) {
      break; // end of the table
    }
    const cells = splitTableRow(line);
    const roleName = cells[0].replace(/`/g, '').trim();
    const roleCells = new Map<Resource, string>();
    for (let col = 0; col < resourceColumns.length; col++) {
      roleCells.set(resourceColumns[col] as Resource, cells[col + 1] ?? '');
    }
    table.set(roleName as Role, roleCells);
  }

  return table;
}

describe('docs/PERMISSIONS.md Table 2 matches lib/authz/index.ts matrix', () => {
  const table2 = parseTable2();

  it('has a row for every ALL_ROLES entry', () => {
    for (const role of ALL_ROLES) {
      expect(table2.has(role), `Table 2 is missing a row for role "${role}"`).toBe(true);
    }
  });

  it('has a column for every ALL_RESOURCES entry', () => {
    const firstRole = table2.get(ALL_ROLES[0]);
    expect(firstRole).toBeDefined();
    for (const resource of ALL_RESOURCES) {
      expect(
        firstRole?.has(resource),
        `Table 2 is missing a column for resource "${resource}"`
      ).toBe(true);
    }
  });

  for (const role of ALL_ROLES) {
    for (const resource of ALL_RESOURCES) {
      it(`${role} x ${resource} cell matches can()`, () => {
        const expected = formatPermissionCell(role, resource);
        const actual = table2.get(role)?.get(resource);
        expect(
          actual,
          `docs/PERMISSIONS.md Table 2's (${role}, ${resource}) cell is ` +
            `"${actual}" but lib/authz/index.ts's matrix computes "${expected}". ` +
            'Update whichever one is stale.'
        ).toBe(expected);
      });
    }
  }
});
