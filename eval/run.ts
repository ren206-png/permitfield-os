// eval/run.ts -- Phase 3/4 eval harness (SS6). Run via `npm run eval`.
//
// Two sections, deliberately separated because they have very different
// trust levels:
//
// 1. OFFLINE checks (always run, no API key required): the per-item
//    citation/kind/Zod validation logic in lib/ai/audit-permit-data.ts
//    (validateAuditFindingItem), the deterministic missing_document logic in
//    lib/inngest/functions/audit.ts (computeMissingDocumentFindings),
//    auditPermitData's zero-retrieved-chunks short-circuit, and (Phase 4)
//    the pure PDF-fill/field-resolution/currency-round-trip logic in
//    lib/pdf/* and lib/money/cents.ts. These are pure functions exercised
//    through their EXACT production code path (imported directly, not
//    reimplemented) -- correctness here doesn't depend on model behavior,
//    so there is no reason to gate them on a live API key.
//
// 2. LIVE checks (extraction accuracy against fixtures): require
//    ANTHROPIC_API_KEY. No key is configured in this environment, so this
//    section prints an explicit SKIPPED banner rather than silently
//    reporting nothing -- this project's own discipline (see README.md /
//    prior phase completion notes) is to never claim an untested path works.
//
// Exit code is 1 if any OFFLINE check fails (these are meant to be safe to
// wire into CI later); a skipped LIVE section does not fail the run.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { PDFDocument } from 'pdf-lib';
import { validateAuditFindingItem, auditPermitData } from '../lib/ai/audit-permit-data';
import { extractPermitData } from '../lib/ai/extract-permit-data';
import { computeMissingDocumentFindings } from '../lib/inngest/functions/audit';
import type { PermitExtraction } from '../lib/ai/schemas/extraction';
import {
  splitApplicantName,
  resolveFieldValue,
  resolveFieldForFilling,
  buildFieldResolutionContext,
  type FieldResolutionContext,
} from '../lib/pdf/resolve-fields';
import { centsToDollarsString, parseCurrencyToCents } from '../lib/money/cents';
import { fillAcroForm } from '../lib/pdf/fill-acroform';
import { fillOverlay } from '../lib/pdf/overlay-coordinates';
import { buildSyntheticAcroFormPdf, buildSyntheticBlankPdf } from './fixtures/synthetic-pdfs';

// Assumes invocation via `npm run eval` (cwd = repo root, per package.json's
// own script convention) rather than __dirname, to stay agnostic of whether
// tsx runs this file as CJS or ESM.
const FIXTURES_DIR = path.join(process.cwd(), 'eval', 'fixtures');

let passCount = 0;
let failCount = 0;

function report(label: string, ok: boolean, detail: string) {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label} -- ${detail}`);
  if (ok) passCount++;
  else failCount++;
}

function loadFixtures<T>(subdir: string): Array<{ file: string; data: T }> {
  const dir = path.join(FIXTURES_DIR, subdir);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => ({ file, data: JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as T }));
}

// --- audit-permit-data: per-item citation/kind/Zod validation (offline) ---

interface AuditFindingFixture {
  description: string;
  shownChunkIds: string[];
  rawFinding: Parameters<typeof validateAuditFindingItem>[0];
  expected: { ok: boolean; reasonContains?: string };
}

function runAuditFindingFixtures() {
  console.log('\n== audit-permit-data: per-item citation/kind/Zod validation (offline) ==');
  for (const { file, data } of loadFixtures<AuditFindingFixture>('audit-findings')) {
    const result = validateAuditFindingItem(data.rawFinding, new Set(data.shownChunkIds));

    if (result.ok !== data.expected.ok) {
      report(file, false, `expected ok=${data.expected.ok}, got ok=${result.ok}. (${data.description})`);
      continue;
    }
    if (!result.ok && data.expected.reasonContains && !result.reason.includes(data.expected.reasonContains)) {
      report(file, false, `rejection reason "${result.reason}" did not contain "${data.expected.reasonContains}"`);
      continue;
    }
    report(file, true, data.description);
  }
}

// --- audit.ts: deterministic missing_document findings (offline) ---

function runMissingDocumentChecks() {
  console.log('\n== audit.ts: deterministic missing_document findings (offline, SS4.3) ==');

  const rules = { requires_document_kinds: ['scope_of_work', 'blueprint'] };

  const allPresent = computeMissingDocumentFindings(rules, new Set(['scope_of_work', 'blueprint']));
  report('all-required-kinds-present', allPresent.length === 0, `expected 0 findings, got ${allPresent.length}`);

  const onePresent = computeMissingDocumentFindings(rules, new Set(['scope_of_work']));
  const onePresentOk =
    onePresent.length === 1 && onePresent[0].kind === 'missing_document' && onePresent[0].code_chunk_id === null;
  report(
    'one-required-kind-missing',
    onePresentOk,
    `expected exactly 1 missing_document finding with null citation, got ${JSON.stringify(onePresent)}`
  );

  const noRules = computeMissingDocumentFindings({}, new Set());
  report('no-compliance-rules', noRules.length === 0, `expected 0 findings for {} compliance_rules, got ${noRules.length}`);
}

// --- audit-permit-data: zero-retrieved-chunks short-circuit (offline) ---

const EMPTY_EXTRACTION: PermitExtraction = {
  applicant_name: { value: null, confidence: 0, source_document_id: null, source_page: null },
  license_number: { value: null, confidence: 0, source_document_id: null, source_page: null },
  square_footage: { value: null, confidence: 0, source_document_id: null, source_page: null },
  electrical_amps: { value: null, confidence: 0, source_document_id: null, source_page: null },
  estimated_job_value_raw: { value: null, confidence: 0, source_document_id: null, source_page: null },
  scope_of_work_summary: { value: null, confidence: 0, source_document_id: null, source_page: null },
};

async function runZeroChunksShortCircuit() {
  console.log('\n== audit-permit-data: zero-retrieved-chunks short-circuit (offline, no API call made) ==');
  // Deliberately not a real Anthropic client -- if auditPermitData's
  // zero-chunk guard is ever removed or reordered, this would throw instead
  // of silently passing, which is the point: it proves no model call
  // happens when there's nothing to cite.
  const uncallableClient = new Proxy(
    {},
    {
      get() {
        throw new Error('auditPermitData should not touch the Anthropic client when retrievedChunks is empty.');
      },
    }
  ) as Anthropic;

  const result = await auditPermitData(uncallableClient, EMPTY_EXTRACTION, []);
  const ok =
    result.structurallyValid === true &&
    result.findings.length === 0 &&
    result.rejected.length === 0 &&
    result.rawResponse === null &&
    result.inputTokens === 0 &&
    result.outputTokens === 0;
  report(
    'zero-chunks-returns-clean-empty-result',
    ok,
    ok
      ? 'an empty corpus (the real current state of jurisdiction_code_chunks) degrades to a clean, no-op result, not an error'
      : `expected a clean empty result; got ${JSON.stringify(result)}`
  );
}

// --- resolve-fields.ts: splitApplicantName (offline, Phase 4) ---

function runSplitApplicantNameChecks() {
  console.log('\n== resolve-fields.ts: splitApplicantName (offline) ==');
  const cases: Array<{ input: string; expected: { firstName: string | null; lastName: string }; description: string }> = [
    { input: 'Jane Smith', expected: { firstName: 'Jane', lastName: 'Smith' }, description: 'two-token name splits on last whitespace' },
    {
      input: 'Mary Jane Watson',
      expected: { firstName: 'Mary Jane', lastName: 'Watson' },
      description: 'multi-token name: everything but the last token is firstName (known limitation for multi-word surnames)',
    },
    { input: 'Cher', expected: { firstName: null, lastName: 'Cher' }, description: 'single-token (mononym) name has no firstName, not an empty string' },
    { input: '   Bob   Builder   ', expected: { firstName: 'Bob', lastName: 'Builder' }, description: 'extra/repeated whitespace is collapsed and trimmed' },
    { input: '', expected: { firstName: null, lastName: '' }, description: 'empty string degrades to an empty lastName, not a crash' },
  ];
  for (const c of cases) {
    const result = splitApplicantName(c.input);
    const ok = result.firstName === c.expected.firstName && result.lastName === c.expected.lastName;
    report(
      `splitApplicantName(${JSON.stringify(c.input)})`,
      ok,
      ok ? c.description : `expected ${JSON.stringify(c.expected)}, got ${JSON.stringify(result)}`
    );
  }
}

// --- resolve-fields.ts: resolveFieldValue / resolveFieldForFilling / buildFieldResolutionContext (offline, Phase 4) ---

const FULL_EXTRACTION: PermitExtraction = {
  applicant_name: { value: 'Jane Q Smith', confidence: 0.9, source_document_id: '11111111-1111-4111-8111-111111111111', source_page: 1 },
  license_number: { value: 'ELEC-12345', confidence: 0.95, source_document_id: '11111111-1111-4111-8111-111111111111', source_page: 1 },
  square_footage: { value: 1200, confidence: 0.8, source_document_id: '11111111-1111-4111-8111-111111111111', source_page: 2 },
  electrical_amps: { value: 200, confidence: 0.9, source_document_id: '11111111-1111-4111-8111-111111111111', source_page: 2 },
  // Deliberately below PDF_FILL_MIN_CONFIDENCE (0.75) -- exercises the
  // confidence-gate check below.
  estimated_job_value_raw: { value: '$12,500.00', confidence: 0.6, source_document_id: '11111111-1111-4111-8111-111111111111', source_page: 3 },
  scope_of_work_summary: { value: 'Upgrade electrical panel', confidence: 0.85, source_document_id: '11111111-1111-4111-8111-111111111111', source_page: 1 },
};

function runResolveFieldValueChecks() {
  console.log('\n== resolve-fields.ts: resolveFieldValue / resolveFieldForFilling (offline) ==');

  const baseContext: FieldResolutionContext = {
    extraction: FULL_EXTRACTION,
    estimatedJobValueCents: 1250000,
    application: { projectTitle: 'Downtown Panel Upgrade' },
    contractor: { companyName: 'Acme Electrical', primaryLicenseNumber: 'ACME-999', licenseProvinceCode: 'ON' },
  };

  const firstName = resolveFieldValue('applicant.firstName', baseContext);
  report(
    'applicant.firstName keeps every token but the last (multi-word first name)',
    firstName.value === 'Jane Q' && firstName.confidence === 0.9,
    `got ${JSON.stringify(firstName)}`
  );

  const lastName = resolveFieldValue('applicant.lastName', baseContext);
  report('applicant.lastName resolves from applicant_name', lastName.value === 'Smith' && lastName.confidence === 0.9, `got ${JSON.stringify(lastName)}`);

  const dollars = resolveFieldValue('application.estimatedJobValueDollars', baseContext);
  report(
    'application.estimatedJobValueDollars is float-free AND tracks the RAW extraction confidence, not a flat 1',
    dollars.value === '12,500.00' && dollars.confidence === 0.6,
    `got ${JSON.stringify(dollars)}`
  );

  const gated = resolveFieldForFilling('application.estimatedJobValueDollars', baseContext);
  report(
    'resolveFieldForFilling blanks a resolved-but-below-threshold value (SS1: 0.6 < PDF_FILL_MIN_CONFIDENCE 0.75)',
    gated.value === null && gated.belowConfidenceThreshold === true,
    `got ${JSON.stringify(gated)}`
  );

  const projectTitle = resolveFieldForFilling('application.projectTitle', baseContext);
  report(
    'application.projectTitle (application-sourced, confidence 1) always passes the confidence gate',
    projectTitle.value === 'Downtown Panel Upgrade' && projectTitle.belowConfidenceThreshold === false,
    `got ${JSON.stringify(projectTitle)}`
  );

  const companyName = resolveFieldForFilling('contractor.companyName', baseContext);
  report(
    'contractor.companyName (contractor-sourced, confidence 1) always passes the confidence gate',
    companyName.value === 'Acme Electrical' && companyName.belowConfidenceThreshold === false,
    `got ${JSON.stringify(companyName)}`
  );

  const nullContractorContext: FieldResolutionContext = { ...baseContext, contractor: null };
  const missingContractor = resolveFieldForFilling('contractor.companyName', nullContractorContext);
  report(
    'a missing contractor is a missing-data blank, distinguishable from a confidence-gated blank',
    missingContractor.value === null && missingContractor.belowConfidenceThreshold === false,
    `got ${JSON.stringify(missingContractor)}`
  );

  const mononymContext: FieldResolutionContext = {
    ...baseContext,
    extraction: { ...FULL_EXTRACTION, applicant_name: { value: 'Cher', confidence: 0.9, source_document_id: '11111111-1111-4111-8111-111111111111', source_page: 1 } },
  };
  const mononymFirst = resolveFieldValue('applicant.firstName', mononymContext);
  report(
    'applicant.firstName is NO_VALUE (not an empty string) for a single-token name',
    mononymFirst.value === null && mononymFirst.confidence === 0,
    `got ${JSON.stringify(mononymFirst)}`
  );
  const mononymLast = resolveFieldValue('applicant.lastName', mononymContext);
  report('applicant.lastName still resolves for a single-token name', mononymLast.value === 'Cher', `got ${JSON.stringify(mononymLast)}`);

  const noExtractionContext: FieldResolutionContext = { ...baseContext, extraction: null };
  const noExtractionLicense = resolveFieldValue('applicant.licenseNumber', noExtractionContext);
  report('AI-sourced fields are NO_VALUE when extraction is null', noExtractionLicense.value === null, `got ${JSON.stringify(noExtractionLicense)}`);
  const noExtractionProjectTitle = resolveFieldValue('application.projectTitle', noExtractionContext);
  report(
    'application-sourced fields still resolve when extraction is null',
    noExtractionProjectTitle.value === 'Downtown Panel Upgrade',
    `got ${JSON.stringify(noExtractionProjectTitle)}`
  );

  let threw = false;
  try {
    resolveFieldValue('nonexistent.path', baseContext);
  } catch {
    threw = true;
  }
  report('resolveFieldValue throws for an unregistered maps_to path rather than resolving to blank', threw, threw ? 'threw as expected' : 'did not throw');
}

function runBuildFieldResolutionContextChecks() {
  console.log('\n== resolve-fields.ts: buildFieldResolutionContext (offline) ==');

  const validParsedData = FULL_EXTRACTION as unknown as Record<string, unknown>;
  const validContext = buildFieldResolutionContext({
    parsedData: validParsedData,
    estimatedJobValueCents: 1250000,
    projectTitle: 'Downtown Panel Upgrade',
    contractor: { company_name: 'Acme Electrical', primary_license_number: 'ACME-999', license_province_code: 'ON' },
  });
  report(
    'valid parsed_data re-parses successfully through PermitExtractionSchema',
    validContext.extraction !== null && validContext.extraction.applicant_name.value === 'Jane Q Smith',
    `got extraction=${JSON.stringify(validContext.extraction)}`
  );

  const degradedContext = buildFieldResolutionContext({
    parsedData: { applicant_name: 'not-a-valid-extracted-field-object' },
    estimatedJobValueCents: 1250000,
    projectTitle: 'Downtown Panel Upgrade',
    contractor: null,
  });
  report(
    'parsed_data that fails re-validation degrades to extraction:null rather than throwing',
    degradedContext.extraction === null,
    `got extraction=${JSON.stringify(degradedContext.extraction)}`
  );
  const degradedProjectTitle = resolveFieldValue('application.projectTitle', degradedContext);
  report(
    'application/contractor-sourced fields still resolve from a degraded (extraction:null) context',
    degradedProjectTitle.value === 'Downtown Panel Upgrade',
    `got ${JSON.stringify(degradedProjectTitle)}`
  );

  const missingParsedDataContext = buildFieldResolutionContext({
    parsedData: null,
    estimatedJobValueCents: null,
    projectTitle: null,
    contractor: null,
  });
  report(
    'parsedData:null (no extraction row / no extraction yet) also degrades to extraction:null, not a throw',
    missingParsedDataContext.extraction === null,
    `got extraction=${JSON.stringify(missingParsedDataContext.extraction)}`
  );
}

// --- money/cents.ts: centsToDollarsString (offline, SS7 adversarial check #7 -- the reverse direction) ---

function runCentsToDollarsStringChecks() {
  console.log('\n== money/cents.ts: centsToDollarsString (offline, float-free) ==');
  const cases: Array<{ cents: bigint; expected: string }> = [
    { cents: 0n, expected: '0.00' },
    { cents: 5n, expected: '0.05' },
    { cents: 100n, expected: '1.00' },
    { cents: 125000050n, expected: '1,250,000.50' },
    { cents: 999n, expected: '9.99' },
  ];
  for (const c of cases) {
    const result = centsToDollarsString(c.cents);
    report(`centsToDollarsString(${c.cents}n)`, result === c.expected, `expected "${c.expected}", got "${result}"`);
  }

  // Full round trip through both directions of the money conversion (SS7
  // adversarial check #7): raw printed string -> cents -> back to a display
  // string, with no float ever touching the value.
  const roundTripCases = ['$1,250,000.50', '1250000', 'CAD 42,000.00', '0.05'];
  for (const raw of roundTripCases) {
    const cents = parseCurrencyToCents(raw);
    if (cents === null) {
      report(`round-trip(${raw})`, false, 'parseCurrencyToCents unexpectedly returned null');
      continue;
    }
    const back = centsToDollarsString(cents);
    report(`round-trip(${raw})`, true, `"${raw}" -> ${cents} cents -> "${back}"`);
  }

  let threw = false;
  try {
    centsToDollarsString(-1n);
  } catch {
    threw = true;
  }
  report('centsToDollarsString throws on a negative amount rather than formatting garbage', threw, threw ? 'threw as expected' : 'did not throw');
}

// --- fill-acroform.ts / overlay-coordinates.ts (offline, synthetic in-memory PDFs -- see eval/fixtures/synthetic-pdfs.ts) ---

async function runFillAcroFormChecks() {
  console.log('\n== fill-acroform.ts: AcroForm field filling (offline, synthetic PDF) ==');
  const templateBytes = await buildSyntheticAcroFormPdf(['Applicant Last name', 'Applicant First name']);

  const result = await fillAcroForm(templateBytes, [
    { pdfFieldName: 'Applicant Last name', value: 'Smith' },
    { pdfFieldName: 'Applicant First name', value: null },
  ]);
  report(
    'fillAcroForm fills only non-null values and leaves null-valued fields untouched',
    result.filledFieldNames.length === 1 && result.filledFieldNames[0] === 'Applicant Last name',
    `got filledFieldNames=${JSON.stringify(result.filledFieldNames)}`
  );

  const reloaded = await PDFDocument.load(result.filledBytes);
  const reloadedValue = reloaded.getForm().getTextField('Applicant Last name').getText();
  report('the filled PDF round-trips the value back out when reloaded', reloadedValue === 'Smith', `got "${reloadedValue}"`);

  let threw = false;
  try {
    await fillAcroForm(templateBytes, [{ pdfFieldName: 'Nonexistent Field', value: 'x' }]);
  } catch {
    threw = true;
  }
  report(
    'fillAcroForm throws on an unknown field name rather than silently skipping (data-integrity mismatch must fail loudly)',
    threw,
    threw ? 'threw as expected' : 'did not throw'
  );
}

async function runFillOverlayChecks() {
  console.log('\n== overlay-coordinates.ts: coordinate-overlay filling (offline, synthetic PDF -- NOT real ESA/Calgary coordinates) ==');
  const templateBytes = await buildSyntheticBlankPdf(1);

  const result = await fillOverlay(templateBytes, [
    { page: 1, x: 50, y: 700, value: 'Smith' },
    { page: 1, x: 50, y: 650, value: null },
  ]);
  report('fillOverlay draws only non-null values', result.filledCount === 1, `expected filledCount=1, got ${result.filledCount}`);

  let threw = false;
  try {
    await fillOverlay(templateBytes, [{ page: 5, x: 0, y: 0, value: 'x' }]);
  } catch {
    threw = true;
  }
  report(
    'fillOverlay throws on an out-of-range page number rather than silently drawing nothing',
    threw,
    threw ? 'threw as expected' : 'did not throw'
  );
}

// --- extract-permit-data: live extraction accuracy (requires ANTHROPIC_API_KEY) ---

interface ExtractionFixture {
  description: string;
  documentId: string;
  filename: string;
  textContent: string;
  expectedFields: Record<string, { value?: unknown; valueContains?: string }>;
}

async function runLiveExtractionFixtures() {
  console.log('\n== extract-permit-data: live extraction accuracy ==');
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log(
      '  SKIPPED -- ANTHROPIC_API_KEY is not set in this environment. This section has not been exercised against a real model; do not treat extraction as verified until it has been.'
    );
    return;
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  for (const { file, data } of loadFixtures<ExtractionFixture>('extraction')) {
    const result = await extractPermitData(client, [
      { id: data.documentId, filename: data.filename, route: 'text', textContent: data.textContent },
    ]);

    if (!result.zodValid || !result.parsed) {
      report(file, false, `extraction failed schema validation: ${result.validationErrors.join('; ')}`);
      continue;
    }

    const mismatches: string[] = [];
    for (const [fieldName, expectation] of Object.entries(data.expectedFields)) {
      const actual = (result.parsed as Record<string, { value: unknown }>)[fieldName]?.value;
      if ('value' in expectation && actual !== expectation.value) {
        mismatches.push(`${fieldName}: expected ${JSON.stringify(expectation.value)}, got ${JSON.stringify(actual)}`);
      }
      if (
        expectation.valueContains &&
        (typeof actual !== 'string' || !actual.toLowerCase().includes(expectation.valueContains.toLowerCase()))
      ) {
        mismatches.push(`${fieldName}: expected to contain "${expectation.valueContains}", got ${JSON.stringify(actual)}`);
      }
    }

    report(file, mismatches.length === 0, mismatches.length === 0 ? data.description : mismatches.join(' | '));
  }
}

async function main() {
  console.log('PermitField OS -- Phase 3 eval harness (SS6)');

  runAuditFindingFixtures();
  runMissingDocumentChecks();
  await runZeroChunksShortCircuit();
  runSplitApplicantNameChecks();
  runResolveFieldValueChecks();
  runBuildFieldResolutionContextChecks();
  runCentsToDollarsStringChecks();
  await runFillAcroFormChecks();
  await runFillOverlayChecks();
  await runLiveExtractionFixtures();

  console.log(`\n${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('eval harness crashed:', err);
  process.exitCode = 1;
});
