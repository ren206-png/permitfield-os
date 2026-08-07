// Every user-visible brand string lives here (SS0.9) so a rename is a
// one-file change. Never hardcode the product name in components, PDFs, or
// emails, and never pass PRODUCT_NAME (or any of these strings) into a prompt
// sent to the model -- the model stays an anonymous analysis step; the brand
// belongs to the UI chrome only (SS0.9).

export const PRODUCT_NAME = 'PermitField OS';
export const PRODUCT_SHORT = 'PermitField';

export const LEGAL_DISCLAIMER =
  'PermitField provides AI-assisted review. Not legal or code advice. ' +
  'Verify with the authority having jurisdiction before submission.';

// Stamped on generated PDFs until the SS0.3 human-review gate is acknowledged.
export const DRAFT_WATERMARK_TEXT = 'PERMITFIELD DRAFT — CONTRACTOR REVIEW REQUIRED';
