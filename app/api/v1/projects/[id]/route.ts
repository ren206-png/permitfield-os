import type { NextRequest } from 'next/server';
import { handleApiRequest } from '@/lib/public-api/handler';
import { getProject } from '@/lib/public-api/resources';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApiRequest(request, (ctx) => getProject(ctx, id));
}
