import { NextResponse } from 'next/server';
import dbApi from '@/src/db.cjs';
import { requireSession } from '@/src/session';
import { wrap } from '@/src/http';

export const GET = wrap(async () => {
  const { session, response } = await requireSession();
  if (response) return response;

  const data = await dbApi.distinctItemNames(session.userId);
  return NextResponse.json(data);
});
