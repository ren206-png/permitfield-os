// Document kinds a contractor picks when uploading (application_documents
// .doc_kind). Shared by the upload form (a client component) and the
// server-rendered document list, which showed the raw value
// ("scope_of_work") -- a server component can't import plain values from a
// 'use client' module.
export const DOC_KINDS = [
  { value: 'blueprint', label: 'Blueprint' },
  { value: 'spec_sheet', label: 'Spec sheet' },
  { value: 'scope_of_work', label: 'Scope of work' },
  { value: 'other', label: 'Other' },
] as const;

export function docKindLabel(value: string): string {
  return DOC_KINDS.find((kind) => kind.value === value)?.label ?? value;
}
