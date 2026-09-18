// Shared by every template in this directory -- every dynamic value
// (client name, org name, invoice number, ...) interpolated into an HTML
// body must go through this first; only the `viewUrl` href itself is
// trusted verbatim (it is server-constructed from lib/seo.ts's SITE_URL
// plus an id, never user-supplied free text).
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
