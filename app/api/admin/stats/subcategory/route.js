import { NextResponse } from 'next/server';
import dbApi from '@/src/db.cjs';
import { requireAdmin } from '@/src/session';
import { wrap } from '@/src/http';

export const GET = wrap(async (request) => {
  const { response } = await requireAdmin();
  if (response) return response;

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  const data = await dbApi.statsBySubcategory(
    searchParams.get('category') || undefined,
    searchParams.get('from') || undefined,
    searchParams.get('to') || undefined,
    userId ? +userId : undefined
  );
  return NextResponse.json(data);
});
