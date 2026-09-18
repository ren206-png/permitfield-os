import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { permitExtract } from '@/lib/inngest/functions/extract';
import { permitAudit } from '@/lib/inngest/functions/audit';
import { permitGeneratePdf } from '@/lib/inngest/functions/generate-pdf';
import { notifyOnFailure } from '@/lib/inngest/functions/notify-on-failure';
import { permitQuotesPaymentsReminders } from '@/lib/inngest/functions/reminders';
import { permitDrawingReview } from '@/lib/inngest/functions/drawing-review';
import { permitNotify, permitNotifyFlush } from '@/lib/inngest/functions/notify';

// Registers permit.extract, permit.audit, permit.generate_pdf,
// permit.notify_on_failure, the Gate 4 (Quotes & Payments)
// quotes-payments-reminders cron, (Gate 5, sub-phase 5.2)
// permit.drawing_review, and (Gate 5, sub-phase 5.3) permit.notify with
// Inngest's dev server / cloud. permit-notify-on-failure and
// permit-notify(-flush) are two independent subscribers to overlapping
// lifecycle events, built in parallel on separate branches -- see
// lib/inngest/client.ts's own event comments and lib/flags.ts's
// isFailureNotificationsEnabled() header for why both are registered rather
// than one superseding the other. Gate 5, sub-phase 5.3 hardening:
// permit-notify-flush is registered alongside permit-notify -- the two are a
// matched record+debounced-flush pair (see notify.ts's own header comment)
// and both must be discoverable by Inngest, not just the one that owns the
// original four trigger names. App Router (Next.js >=13) requires exporting
// each HTTP method individually rather than a default export -- see
// node_modules/inngest/next.d.ts's own example.
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    permitExtract,
    permitAudit,
    permitGeneratePdf,
    notifyOnFailure,
    permitQuotesPaymentsReminders,
    permitDrawingReview,
    permitNotify,
    permitNotifyFlush,
  ],
});
