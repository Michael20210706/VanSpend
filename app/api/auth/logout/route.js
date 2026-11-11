import { NextResponse } from 'next/server';
import { getSession } from '@/src/session';
import { wrap } from '@/src/http';

export const POST = wrap(async () => {
  const session = await getSession();
  session.destroy();
  return NextResponse.json({ ok: true });
});
