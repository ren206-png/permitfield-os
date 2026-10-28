import { describe, expect, it } from 'vitest';
import { decodeEntities, htmlToSections, loadSourceDocument } from './loaders';

const html = (body: string) => Buffer.from(`<!doctype html><html><head><title>t</title><script>alert(1)</script></head><body>${body}</body></html>`);

describe('htmlToSections', () => {
  it('locates text by heading path and reads only <main>', () => {
    const sections = htmlToSections(`
      <nav><a href="/">Home</a> Site menu</nav>
      <main>
        <h1>Building permits</h1><p>Apply online.</p>
        <h2>Fees</h2><p>Residential: $15.00 per m&sup2;</p>
        <h3>Exemptions</h3><p>Sheds under 10 m&sup2;.</p>
        <h2>Forms</h2><ul><li>Form A</li><li>Form B</li></ul>
      </main>
      <footer>© City</footer>`);
    expect(sections).toEqual([
      { locator: 'Building permits', text: 'Apply online.' },
      { locator: 'Building permits › Fees', text: 'Residential: $15.00 per m²' },
      { locator: 'Building permits › Fees › Exemptions', text: 'Sheds under 10 m².' },
      // Each list item is its own paragraph.
      { locator: 'Building permits › Forms', text: 'Form A\n\nForm B' },
    ]);
  });

  it('a skipped heading level does not leave a stale entry in the path', () => {
    const sections = htmlToSections('<h1>A</h1><h3>C</h3><p>one</p><h3>D</h3><p>two</p><h2>B</h2><p>three</p>');
    expect(sections.map((s) => s.locator)).toEqual(['A › C', 'A › D', 'A › B']);
  });

  it('drops scripts, styles, comments, forms and embedded objects -- nothing executable becomes text', () => {
    const sections = htmlToSections(
      '<p>Keep</p><script>steal()</script><style>p{}</style><!-- hidden instructions --><form><input value="x">Search</form><iframe src="x">frame</iframe><svg><text>svg</text></svg>'
    );
    expect(sections).toEqual([{ locator: 'Page', text: 'Keep' }]);
  });

  it('decodes entities without inventing characters', () => {
    expect(decodeEntities('&amp; &lt;b&gt; &#36;5 &#x24;6 &sect;3.1 &bogus;')).toBe('& <b> $5 $6 §3.1 &bogus;');
  });
});

describe('loadSourceDocument', () => {
  it('loads HTML', async () => {
    const result = await loadSourceDocument(html('<h1>Fees</h1><p>$10</p>'), 'text/html; charset=utf-8');
    expect(result).toMatchObject({ ok: true, loader: 'html', sections: [{ locator: 'Fees', text: '$10' }] });
  });

  it('loads plain text', async () => {
    const result = await loadSourceDocument(Buffer.from('Line one\r\n\r\n\r\nLine two'), 'text/plain');
    expect(result).toMatchObject({ ok: true, loader: 'text', sections: [{ locator: 'Document', text: 'Line one\n\nLine two' }] });
  });

  it('refuses unsupported types explicitly', async () => {
    for (const type of [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'text/csv',
      'image/png',
      'application/zip',
      '',
    ]) {
      const result = await loadSourceDocument(Buffer.from('PK\u0003\u0004'), type);
      expect(result).toMatchObject({ ok: false, code: 'unsupported_content' });
    }
  });

  it('refuses a declared type the bytes do not match', async () => {
    expect(await loadSourceDocument(Buffer.from('<html>not a pdf</html>'), 'application/pdf')).toMatchObject({ ok: false, code: 'signature_mismatch' });
    expect(await loadSourceDocument(Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0x01]), 'text/html')).toMatchObject({
      ok: false,
      code: 'signature_mismatch',
    });
  });

  it('a page with no readable text is empty, not an empty revision', async () => {
    expect(await loadSourceDocument(html('<script>only()</script>'), 'text/html')).toMatchObject({ ok: false, code: 'empty_text' });
  });

  it('loads a text PDF page by page, located as "p. N"', async () => {
    const { PDFDocument, StandardFonts } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage().drawText('Schedule A: building permit fees', { x: 50, y: 700, font, size: 12 });
    doc.addPage().drawText('Schedule B: demolition permit fees', { x: 50, y: 700, font, size: 12 });
    const result = await loadSourceDocument(Buffer.from(await doc.save()), 'application/pdf');
    expect(result).toMatchObject({
      ok: true,
      loader: 'pdf',
      sections: [
        { locator: 'p. 1', text: expect.stringContaining('Schedule A: building permit fees') },
        { locator: 'p. 2', text: expect.stringContaining('Schedule B: demolition permit fees') },
      ],
    });
  });

  it('an unreadable PDF fails, never throws', async () => {
    expect(await loadSourceDocument(Buffer.from('%PDF-1.7 garbage'), 'application/pdf')).toMatchObject({ ok: false, code: 'parse_failed' });
  });
});
