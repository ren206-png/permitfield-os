// Splits document text into overlapping chunks for retrieval. Splits on
// paragraph breaks first so a chunk rarely ends mid-sentence; a paragraph
// longer than maxChars is cut on whitespace. The overlap keeps a fact that
// straddles a boundary findable from either side.
export interface ChunkOptions {
  maxChars?: number;
  overlapChars?: number;
}

export const DEFAULT_CHUNK_CHARS = 1500;
export const DEFAULT_CHUNK_OVERLAP_CHARS = 150;

function splitLongParagraph(paragraph: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let rest = paragraph;
  while (rest.length > maxChars) {
    let cut = rest.lastIndexOf(' ', maxChars);
    if (cut < maxChars / 2) cut = maxChars;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

export function chunkText(text: string, options: ChunkOptions = {}): string[] {
  const maxChars = options.maxChars ?? DEFAULT_CHUNK_CHARS;
  const overlapChars = Math.min(options.overlapChars ?? DEFAULT_CHUNK_OVERLAP_CHARS, Math.floor(maxChars / 2));

  const paragraphs = text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0)
    .flatMap((p) => splitLongParagraph(p, maxChars));

  const chunks: string[] = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 1 > maxChars) {
      chunks.push(current);
      const tail = overlapChars > 0 ? current.slice(-overlapChars) : '';
      const wordStart = tail.indexOf(' ');
      current = `${wordStart >= 0 ? tail.slice(wordStart + 1) : tail} ${paragraph}`.trim();
    } else {
      current = current ? `${current} ${paragraph}` : paragraph;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
