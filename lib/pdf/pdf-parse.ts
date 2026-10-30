import type { PDFParse as PDFParseType } from 'pdf-parse';

// The one way server code loads pdf-parse (text-density.ts, sources/loaders.ts).
//
// pdfjs-dist needs DOMMatrix (and Path2D, ImageData) on the global object.
// On its own it looks for @napi-rs/canvas through createRequire(), which
// Vercel's file tracing cannot follow, so the package never reached the
// deployed functions and every PDF failed with "DOMMatrix is not defined"
// (production source checks on 2026-10-30; document extraction silently
// fell back to vision). pdf-parse/worker imports @napi-rs/canvas statically
// -- traceable, including its per-platform native binary -- and installs
// those globals, so it must load before pdf-parse itself.
// scripts/check-pdf-trace.mjs fails CI if the canvas binary drops out of a
// PDF-reading route's trace again.
//
// Dynamic, never top-level: see text-density.ts on why a native-module
// failure must stay inside the caller instead of crashing the whole route.

export async function createPdfParser(data: Buffer): Promise<PDFParseType> {
  const { CanvasFactory } = await import('pdf-parse/worker');
  const { PDFParse } = await import('pdf-parse');
  return new PDFParse({ data, CanvasFactory });
}
