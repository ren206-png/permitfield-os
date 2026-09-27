import { NextRequest, NextResponse } from 'next/server';
import { resolveTargetToken, getBridgeRequestContext } from '@/lib/bridge/client-portal';
import { loadSigningView } from '@/lib/esign/permit-signatures';
import { createServiceClient } from '@/lib/supabase/service-client';
import { GENERATED_BUCKET } from '@/lib/storage/documents';

// The filled form a signer reviews from app/sign/[token] -- always the latest
// one generated for the filing, which is the one they sign. Token-authorized;
// every failure is the same 404.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const notFound = NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const resolved = await resolveTargetToken(token, 'permit_signature', await getBridgeRequestContext());
  if ('error' in resolved) return notFound;

  const service = createServiceClient();
  const view = await loadSigningView(service, resolved.orgId, resolved.targetId);
  if (!view || view.status === 'cancelled' || !view.document) return notFound;

  const { data: blob, error } = await service.storage.from(GENERATED_BUCKET).download(view.document.storagePath);
  if (error || !blob) return notFound;

  return new NextResponse(Buffer.from(await blob.arrayBuffer()), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${view.status === 'signed' ? 'signed' : 'filled'}-permit-form.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
