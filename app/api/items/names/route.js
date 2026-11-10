import { NextResponse } from 'next/server';
import dbApi from '@/src/db.cjs';
import { requireSession } from '@/src/session';
import { wrap, memberScope } from '@/src/http';

export const GET = wrap(async () => {
  const { session, response } = await requireSession();
  if (response) return response;

  const scope = memberScope(session);
  const data = await dbApi.distinctItemNames(scope);
  return NextResponse.json(data);
});
