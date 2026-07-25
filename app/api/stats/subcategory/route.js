import { NextResponse } from 'next/server';
import dbApi from '@/src/db.cjs';
import { requireSession } from '@/src/session';
import { wrap } from '@/src/http';

export const GET = wrap(async (request) => {
  const { session, response } = await requireSession();
  if (response) return response;

  const { searchParams } = new URL(request.url);
  const scope = session.familyId ? { familyId: session.familyId } : { userId: session.userId };
  const data = await dbApi.statsBySubcategory(
    searchParams.get('category') || undefined,
    searchParams.get('from') || undefined,
    searchParams.get('to') || undefined,
    scope
  );
  return NextResponse.json(data);
});
