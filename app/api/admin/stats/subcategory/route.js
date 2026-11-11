import { NextResponse } from 'next/server';
import dbApi from '@/src/db.cjs';
import { requireAdmin } from '@/src/session';
import { wrap, readDateParam, readIdParam } from '@/src/http';

export const GET = wrap(async (request) => {
  const { response } = await requireAdmin();
  if (response) return response;

  const { searchParams } = new URL(request.url);
  const userId = readIdParam(searchParams, 'userId');
  const data = await dbApi.statsBySubcategory(
    searchParams.get('category') || undefined,
    readDateParam(searchParams, 'from'),
    readDateParam(searchParams, 'to'),
    userId ? { userId } : undefined
  );
  return NextResponse.json(data);
});
