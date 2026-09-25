import type { NextRequest } from 'next/server';
import { handleApiRequest } from '@/lib/public-api/handler';
import { listProjects } from '@/lib/public-api/resources';

export async function GET(request: NextRequest) {
  return handleApiRequest(request, (ctx) => listProjects(ctx));
}
