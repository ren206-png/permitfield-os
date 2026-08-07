import { describe, it, expect } from 'vitest';
import { can, ALL_ROLES, ALL_RESOURCES, ALL_ACTIONS, type Role, type Resource } from './index';

// Lifecycle & Compliance Expansion, Phase 1.0. This repo's first test file --
// vitest was installed specifically for this (see PHASE_0_FINDINGS.md SS I
// #4: no test framework existed before this phase). Kept deliberately
// framework-free (no DB, no Next.js, no mocks): can() is a pure function, so
// these tests exercise the exact same code that will eventually be called
// from a route, with no environment gap to explain away.

describe('can() — total function, never throws', () => {
  it('returns a boolean for every role x action x resource combination', () => {
    for (const role of ALL_ROLES) {
      for (const action of ALL_ACTIONS) {
        for (const resource of ALL_RESOURCES) {
          expect(typeof can(role, action, resource)).toBe('boolean');
        }
      }
    }
  });

  it('fails closed for an unmodeled role/resource pair (client_user x org_members)', () => {
    // client_user has no org_members entry in the matrix at all.
    expect(can('client_user', 'read', 'org_members')).toBe(false);
    expect(can('client_user', 'create', 'org_members')).toBe(false);
  });
});

describe('legacy roles mirror current RLS reality (Table 1 of docs/PERMISSIONS.md)', () => {
  // contractors_delete / permit_applications_delete require is_org_owner
  // (20260806000003, 20260806000006) -- a plain member cannot archive either.
  it('member cannot archive contractors or permit_applications', () => {
    expect(can('member', 'archive', 'contractors')).toBe(false);
    expect(can('member', 'archive', 'permit_applications')).toBe(false);
  });

  it('owner and org_owner can archive contractors and permit_applications', () => {
    for (const role of ['owner', 'org_owner'] as const) {
      expect(can(role, 'archive', 'contractors')).toBe(true);
      expect(can(role, 'archive', 'permit_applications')).toBe(true);
    }
  });

  // org_members_insert/update/delete all require is_org_owner
  // (20260806000002 L100-111) -- member has no org_members entry at all.
  it('member cannot create, read, update, or archive org_members', () => {
    for (const action of ALL_ACTIONS) {
      expect(can('member', action, 'org_members')).toBe(false);
    }
  });

  it('owner and org_owner can fully manage org_members', () => {
    for (const role of ['owner', 'org_owner'] as const) {
      for (const action of ALL_ACTIONS) {
        expect(can(role, action, 'org_members')).toBe(true);
      }
    }
  });

  // app/api/applications/[id]/findings/[findingId]/review/route.ts only
  // checks is_org_member -- any member can confirm/dismiss.
  it('member can read and update (review) audit_findings_review', () => {
    expect(can('member', 'read', 'audit_findings_review')).toBe(true);
    expect(can('member', 'update', 'audit_findings_review')).toBe(true);
  });

  it('no role can create or archive audit_findings_review (append-only except review columns)', () => {
    for (const role of ALL_ROLES) {
      expect(can(role, 'create', 'audit_findings_review')).toBe(false);
      expect(can(role, 'archive', 'audit_findings_review')).toBe(false);
    }
  });
});

describe('audit_logs — narrower than plain membership by design', () => {
  it('every role can create its own audit_logs entry except client_user', () => {
    for (const role of ALL_ROLES) {
      const expected = role !== 'client_user';
      expect(can(role, 'create', 'audit_logs')).toBe(expected);
    }
  });

  it('no role can ever update or archive audit_logs (immutable ledger)', () => {
    for (const role of ALL_ROLES) {
      expect(can(role, 'update', 'audit_logs')).toBe(false);
      expect(can(role, 'archive', 'audit_logs')).toBe(false);
    }
  });

  it('client_user cannot read audit_logs', () => {
    expect(can('client_user', 'read', 'audit_logs')).toBe(false);
  });
});

describe('client_user — deliberately minimal, do not assign to real users', () => {
  const allowedResources: Resource[] = ['permit_applications', 'generated_documents'];

  it('has read access to exactly permit_applications and generated_documents, nothing else', () => {
    for (const resource of ALL_RESOURCES) {
      const expectRead = allowedResources.includes(resource);
      expect(can('client_user', 'read', resource)).toBe(expectRead);
    }
  });

  it('can never create, update, or archive anything', () => {
    for (const resource of ALL_RESOURCES) {
      expect(can('client_user', 'create', resource)).toBe(false);
      expect(can('client_user', 'update', resource)).toBe(false);
      expect(can('client_user', 'archive', resource)).toBe(false);
    }
  });
});

describe('auditor_readonly — read (and self-log) only, everywhere, forever', () => {
  it('can read every resource', () => {
    for (const resource of ALL_RESOURCES) {
      expect(can('auditor_readonly', 'read', resource)).toBe(true);
    }
  });

  it('cannot create, update, or archive anything except creating its own audit_logs entry', () => {
    for (const resource of ALL_RESOURCES) {
      if (resource === 'audit_logs') {
        expect(can('auditor_readonly', 'create', resource)).toBe(true);
      } else {
        expect(can('auditor_readonly', 'create', resource)).toBe(false);
      }
      expect(can('auditor_readonly', 'update', resource)).toBe(false);
      expect(can('auditor_readonly', 'archive', resource)).toBe(false);
    }
  });
});

describe('platform_admin — full surface on every mutable resource', () => {
  it('has all four actions on organizations, org_members, contractors, permit_applications, application_documents, generated_documents', () => {
    const fullResources: Resource[] = [
      'organizations',
      'org_members',
      'contractors',
      'permit_applications',
      'application_documents',
      'generated_documents',
    ];
    for (const resource of fullResources) {
      for (const action of ALL_ACTIONS) {
        expect(can('platform_admin', action, resource)).toBe(true);
      }
    }
  });

  it('still cannot update or archive the append-only AI resources (extractions, audits)', () => {
    for (const resource of ['extractions', 'audits'] as Resource[]) {
      expect(can('platform_admin', 'update', resource)).toBe(false);
      expect(can('platform_admin', 'archive', resource)).toBe(false);
    }
  });
});

describe('coverage: every declared role has at least one resource entry', () => {
  it.each(ALL_ROLES)('%s is not an empty permission set', (role: Role) => {
    const hasAny = ALL_RESOURCES.some((resource) =>
      ALL_ACTIONS.some((action) => can(role, action, resource))
    );
    expect(hasAny).toBe(true);
  });
});
