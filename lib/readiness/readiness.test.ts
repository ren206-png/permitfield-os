import { describe, it, expect } from 'vitest';
import { nextPermitStatusOptions, permitStatusErrorMessage, suggestedChecklistItems } from './readiness';

describe('nextPermitStatusOptions()', () => {
  it('offers the legal next steps the role may take', () => {
    expect(nextPermitStatusOptions('internal_review', 'member')).toEqual(['ready_to_submit', 'collecting_documents', 'withdrawn']);
    expect(nextPermitStatusOptions(null, 'member')).toEqual(['intake']);
  });

  it('never offers submitted, which is reached by submitting', () => {
    expect(nextPermitStatusOptions('ready_to_submit', 'owner')).toEqual(['collecting_documents', 'withdrawn']);
  });

  it('hides jurisdiction outcomes from roles below permit coordinator', () => {
    expect(nextPermitStatusOptions('under_municipal_review', 'member')).toEqual([]);
    expect(nextPermitStatusOptions('under_municipal_review', 'permit_coordinator')).toEqual([
      'revision_requested',
      'approved',
      'rejected',
      'issued',
    ]);
  });

  it('offers nothing from a terminal status', () => {
    expect(nextPermitStatusOptions('closed', 'owner')).toEqual([]);
  });
});

describe('permitStatusErrorMessage()', () => {
  it('turns database errors into next steps', () => {
    expect(permitStatusErrorMessage('readiness_incomplete: application x has incomplete…')).toMatch(/checklist/);
    expect(permitStatusErrorMessage('insufficient_privilege: role member may not…')).toMatch(/permit manager/);
    expect(permitStatusErrorMessage('invalid_reason: readiness override reason must be…')).toMatch(/20 characters/);
    expect(permitStatusErrorMessage('something else')).toMatch(/could not be saved/);
  });
});

describe('suggestedChecklistItems()', () => {
  const filings = [
    { authorityName: 'City of Vancouver', hasFilledForm: true, esignatureAccepted: true, hasSignatureSlot: true },
    { authorityName: 'ESA', hasFilledForm: false, esignatureAccepted: false, hasSignatureSlot: true },
  ];

  it('suggests a check per filled form, a signing step per signed form, and the documents', () => {
    expect(suggestedChecklistItems({ filings, existingTitles: [] }).map((i) => i.title)).toEqual([
      'Check the filled City of Vancouver form',
      'Get the City of Vancouver form signed',
      'Get the ESA form signed',
      'Attach drawings and supporting documents',
    ]);
  });

  it('says how to sign depending on whether the authority accepts e-signatures', () => {
    const items = suggestedChecklistItems({ filings, existingTitles: [] });
    expect(items[1].description).toMatch(/electronic signature/);
    expect(items[2].description).toMatch(/by hand/);
  });

  it('skips titles already on the checklist', () => {
    const titles = suggestedChecklistItems({ filings, existingTitles: ['attach drawings and supporting documents', 'Get the ESA form signed'] }).map((i) => i.title);
    expect(titles).toEqual(['Check the filled City of Vancouver form', 'Get the City of Vancouver form signed']);
  });

  describe('with the city checklist on file', () => {
    const source = 'https://vancouver.ca/files/cov/renovation-commercial-building-checklist.pdf';
    const cityRequirements = [
      { title: 'Building Permit Data Sheet', description: "Vancouver's data sheet (Excel).", appliesWhen: null, sourceUrl: source },
      {
        title: 'K1 Restaurant or Kitchen Exhaust Systems form',
        description: null,
        appliesWhen: 'Required if a commercial kitchen is added or renovated.',
        sourceUrl: source,
      },
    ];

    it("lists the city's items instead of the generic documents item, in the city's order", () => {
      const titles = suggestedChecklistItems({ filings, cityRequirements, existingTitles: [] }).map((i) => i.title);
      expect(titles).toEqual([
        'Check the filled City of Vancouver form',
        'Get the City of Vancouver form signed',
        'Get the ESA form signed',
        'Building Permit Data Sheet',
        'K1 Restaurant or Kitchen Exhaust Systems form',
      ]);
    });

    it('makes always-required items required and conditional ones optional, with the condition first', () => {
      const [dataSheet, kitchen] = suggestedChecklistItems({ filings: [], cityRequirements, existingTitles: [] });
      expect(dataSheet).toEqual({
        title: 'Building Permit Data Sheet',
        description: "Vancouver's data sheet (Excel).",
        isRequired: true,
        sourceRequirement: source,
        catalogRequirementId: null,
      });
      expect(kitchen).toEqual({
        title: 'K1 Restaurant or Kitchen Exhaust Systems form',
        description: 'Required if a commercial kitchen is added or renovated.',
        isRequired: false,
        sourceRequirement: source,
        catalogRequirementId: null,
      });
    });

    it('skips city items already on the checklist, and repeats within the city list', () => {
      const titles = suggestedChecklistItems({
        filings: [],
        cityRequirements: [...cityRequirements, cityRequirements[0]],
        existingTitles: ['k1 restaurant or kitchen exhaust systems form '],
      }).map((i) => i.title);
      expect(titles).toEqual(['Building Permit Data Sheet']);
    });
  });
});
