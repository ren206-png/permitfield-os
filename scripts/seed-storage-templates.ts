// Fixes a real gap found during the jurisdiction-expansion follow-up
// (see MARKETING_CAPABILITY_LEDGER.md §3's evidence column): the
// `permitfield-form-templates` Storage bucket (migration
// 20260806000017_filing_form_templates_and_generated_documents.sql) is
// created empty, but `permit_type_filings.form_template_path` in
// supabase/seed.sql references specific object paths, and
// lib/inngest/functions/generate-pdf.ts downloads from those paths at
// runtime. Until this script (or an equivalent) has actually been run
// against a given Supabase project, PDF generation fails for every
// jurisdiction seeded so far -- this was true for Toronto alone before
// Surrey/Vancouver were added, not a regression introduced by adding them.
//
// Source of truth for the manifest below: the exact `form_template_path`
// values in supabase/seed.sql's `permit_type_filings` insert, paired with
// the real government PDF already committed at that path under
// docs-reference-forms/ (downloaded and pdf-lib-inspected per
// PHASE_0_FINDINGS.md and JURISDICTION_EXPANSION_SCOPE.md). Uploads all 8,
// including ESA's and Calgary's -- those two have no `permit_form_fields`
// rows (no verified AcroForm map, ESA's form is flat/scanned, Calgary's
// needs manual review first per seed.sql's own comment), but the bucket
// still needs real bytes at their paths for the download step in
// generate-pdf.ts not to 404 once/if those filings are ever exercised.
//
// Idempotent (upsert), safe to re-run. Requires SUPABASE_SERVICE_ROLE_KEY
// and NEXT_PUBLIC_SUPABASE_URL (see .env.example) -- createServiceClient()
// throws a clear error if either is missing, same as every other caller of
// that module.
//
// Usage: npm run seed:storage
// (after `supabase start` + `supabase db reset`, so the bucket already
// exists -- this script does not create the bucket, only populates it.)

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createServiceClient } from '../lib/supabase/service-client';
import { FORM_TEMPLATES_BUCKET } from '../lib/storage/documents';

const REPO_ROOT = path.resolve(__dirname, '..');
const REFERENCE_FORMS_DIR = path.join(REPO_ROOT, 'docs-reference-forms');

interface TemplateUpload {
  /** Object path inside FORM_TEMPLATES_BUCKET -- must exactly match a
   *  `permit_type_filings.form_template_path` value in supabase/seed.sql. */
  bucketPath: string;
  /** Real government PDF already committed under docs-reference-forms/. */
  localFile: string;
}

const TEMPLATE_MANIFEST: TemplateUpload[] = [
  {
    bucketPath: 'toronto/permit-to-construct-or-demolish.pdf',
    localFile: 'toronto-permit-application.pdf',
  },
  {
    bucketPath: 'esa/icia-low-voltage.pdf',
    localFile: 'esa-icia-low-voltage.pdf',
  },
  {
    bucketPath: 'calgary/commercial-building-project-application.pdf',
    localFile: 'calgary-commercial-permit.pdf',
  },
  {
    bucketPath: 'surrey/building-permit-application.pdf',
    localFile: 'surrey-building-permit-application.pdf',
  },
  {
    bucketPath: 'vancouver/dev-build-app-form.pdf',
    localFile: 'vancouver-dev-build-app-form.pdf',
  },
  {
    bucketPath: 'richmond/building-permit-application-addition-alterations.pdf',
    localFile: 'richmond-pl43-addition-alterations.pdf',
  },
  {
    bucketPath: 'coquitlam/permit-application-form.pdf',
    localFile: 'coquitlam-permit-application-form.pdf',
  },
  {
    bucketPath: 'port-coquitlam/building-permit-application-tenant-improvement.pdf',
    localFile: 'port-coquitlam-ti-application.pdf',
  },
];

async function main() {
  const supabase = createServiceClient();
  let failures = 0;

  for (const { bucketPath, localFile } of TEMPLATE_MANIFEST) {
    const localPath = path.join(REFERENCE_FORMS_DIR, localFile);
    let bytes: Buffer;
    try {
      bytes = await readFile(localPath);
    } catch (err) {
      failures += 1;
      console.error(`[FAIL] ${bucketPath} -- could not read ${localPath}: ${(err as Error).message}`);
      continue;
    }

    const { error } = await supabase.storage
      .from(FORM_TEMPLATES_BUCKET)
      .upload(bucketPath, bytes, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (error) {
      failures += 1;
      console.error(`[FAIL] ${bucketPath} -- upload error: ${error.message}`);
      continue;
    }

    console.log(`[OK]   ${bucketPath} (${bytes.byteLength.toLocaleString()} bytes, from ${localFile})`);
  }

  if (failures > 0) {
    console.error(`\n${failures} of ${TEMPLATE_MANIFEST.length} template upload(s) failed.`);
    process.exit(1);
  }

  console.log(`\nAll ${TEMPLATE_MANIFEST.length} form templates uploaded to '${FORM_TEMPLATES_BUCKET}'.`);
}

main().catch((err) => {
  console.error('seed-storage-templates failed:', err);
  process.exit(1);
});
