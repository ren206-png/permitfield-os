import { NextResponse } from 'next/server';
import { isPublicApiEnabled } from '@/lib/flags';
import { buildOpenApiDocument } from '@/lib/public-api/openapi';
import { SITE_URL } from '@/lib/seo';

export async function GET() {
  if (!isPublicApiEnabled()) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Not found.' } }, { status: 404 });
  }
  return NextResponse.json(buildOpenApiDocument(SITE_URL));
}
