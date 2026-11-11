import { NextResponse } from 'next/server';
import dbApi from '@/src/db.cjs';
import { requireSession } from '@/src/session';
import { wrap, memberScope, readDateParam } from '@/src/http';

export const GET = wrap(async (request) => {
  const { session, response } = await requireSession();
  if (response) return response;

  const { searchParams } = new URL(request.url);
  const scope = memberScope(session);
  const data = await dbApi.statsBySubcategory(
    searchParams.get('category') || undefined,
    readDateParam(searchParams, 'from'),
    readDateParam(searchParams, 'to'),
    scope
  );
  return NextResponse.json(data);
});
