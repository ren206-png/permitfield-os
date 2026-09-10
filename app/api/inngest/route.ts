import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { permitExtract } from '@/lib/inngest/functions/extract';
import { permitAudit } from '@/lib/inngest/functions/audit';
import { permitGeneratePdf } from '@/lib/inngest/functions/generate-pdf';
import { notifyOnFailure } from '@/lib/inngest/functions/notify-on-failure';

// Registers permit.extract, permit.audit, permit.generate_pdf, and
// permit.notify_on_failure with Inngest's dev server / cloud. App Router
// (Next.js >=13) requires exporting each HTTP method individually rather
// than a default export -- see node_modules/inngest/next.d.ts's own
// example.
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [permitExtract, permitAudit, permitGeneratePdf, notifyOnFailure],
});
