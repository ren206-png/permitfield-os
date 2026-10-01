import fs from 'node:fs';
import { PDFDocument, PDFTextField, PDFCheckBox, PDFSignature } from 'pdf-lib';
for (const f of process.argv.slice(2)) {
  const doc = await PDFDocument.load(new Uint8Array(fs.readFileSync(f)), { ignoreEncryption: true });
  const fields = doc.getForm().getFields();
  console.log(`\n=== ${f}: ${doc.getPageCount()} pages, ${fields.length} fields`);
  if (process.env.FULL) for (const fld of fields) {
    const t = fld instanceof PDFTextField ? 'Tx' : fld instanceof PDFCheckBox ? 'Cb' : fld instanceof PDFSignature ? 'Sig' : fld.constructor.name;
    const w = fld.acroField.getWidgets()[0]; const r = w?.getRectangle();
    const pageIdx = doc.getPages().findIndex((p) => p.ref === w?.P());
    console.log(`${t.padEnd(4)} p${pageIdx + 1} ${r ? [r.x, r.y].map((n) => n.toFixed(0)).join(',') : ''} ${fld.getName()}`);
  }
}
