// Gate AI-1, sub-phase AI-1.3. Zod shapes for the document-classification
// task (lib/ai/classify-document.ts). Unlike lib/ai/schemas/extraction.ts /
// audit.ts / drawing-review.ts, the thing being validated here isn't a
// tool-use `input` object (lib/ai/gemini/client.ts's generateContent has no
// tool-use/forced-JSON support -- see that file's header) but a JSON value
// this codebase itself parsed out of the model's raw text response. Same
// role either way: the one structural gate between "whatever the model
// returned" and a value trusted enough to write to
// application_documents.ai_suggested_doc_kind
// (20260806000064_application_documents_ai_classification.sql).

import { z } from 'zod';

// Kept in sync with the `doc_kind` Postgres enum
// (20260806000006_applications_and_documents.sql: 'blueprint' | 'spec_sheet'
// | 'scope_of_work' | 'other'). Duplicated here rather than imported from
// app/api/documents/route.ts's own local DOC_KINDS/DocKind -- that file
// doesn't export either, and this is the same hand-maintained-enum-pair
// discipline lib/ai/schemas/ai-task.ts's own header already documents for
// ai_task_kind/ai_provider/ai_job_status.
export const DocKindSchema = z.enum(['blueprint', 'spec_sheet', 'scope_of_work', 'other']);
export type DocKind = z.infer<typeof DocKindSchema>;

// The full shape a classification response must satisfy, once this
// codebase has parsed the model's raw text as JSON.
export const DocumentClassificationSchema = z.object({
  doc_kind: DocKindSchema,
  confidence: z.number().min(0).max(1),
});
export type DocumentClassification = z.infer<typeof DocumentClassificationSchema>;
