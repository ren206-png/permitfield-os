// CI guard (run after `next build`): every server route whose file trace
// includes pdf-parse must also ship @napi-rs/canvas and its native binary
// for the build platform. Without them pdfjs throws "DOMMatrix is not
// defined" on Vercel and every PDF fails to read (lib/pdf/pdf-parse.ts).
// Fails loud if no route reads PDFs at all, so a renamed path can't pass
// vacuously.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = '.next/server';

function traces(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return traces(path);
    return path.endsWith('.nft.json') ? [path] : [];
  });
}

const failures = [];
let pdfRoutes = 0;
for (const file of traces(root)) {
  const files = JSON.parse(readFileSync(file, 'utf8')).files;
  if (!files.some((f) => f.includes('node_modules/pdf-parse/'))) continue;
  pdfRoutes++;
  const route = relative(root, file);
  const missing = [];
  if (!files.some((f) => f.includes('node_modules/pdf-parse/dist/worker/'))) missing.push('pdf-parse/worker');
  if (!files.some((f) => f.includes('node_modules/@napi-rs/canvas/'))) missing.push('@napi-rs/canvas');
  if (!files.some((f) => /node_modules\/@napi-rs\/canvas-[^/]+\/.+\.node$/.test(f))) missing.push('@napi-rs/canvas native binary');
  if (missing.length) failures.push(`${route}: missing ${missing.join(', ')}`);
}

if (pdfRoutes === 0) {
  console.error('check-pdf-trace: no route traces pdf-parse; expected at least app/api/inngest/route.');
  process.exit(1);
}
if (failures.length) {
  console.error(`check-pdf-trace: ${failures.length} route(s) would fail to read PDFs when deployed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`check-pdf-trace: ${pdfRoutes} PDF-reading route(s) ship @napi-rs/canvas and its native binary.`);
