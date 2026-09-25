import type { NextRequest } from 'next/server';
import { handleApiRequest } from '@/lib/public-api/handler';
import { listApplications } from '@/lib/public-api/resources';

export async function GET(request: NextRequest) {
  return handleApiRequest(request, (ctx) => listApplications(ctx));
}
