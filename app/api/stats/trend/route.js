import { NextResponse } from 'next/server';
import dbApi from '@/src/db.cjs';
import { requireSession } from '@/src/session';
import { wrap, memberScope } from '@/src/http';

export const GET = wrap(async (request) => {
  const { session, response } = await requireSession();
  if (response) return response;

  const { searchParams } = new URL(request.url);
  const name = searchParams.get('name');
  if (!name) return NextResponse.json({ error: '缺少 name' }, { status: 400 });
  const scope = memberScope(session);
  const data = await dbApi.priceTrend(name, searchParams.get('store') || undefined, scope);
  return NextResponse.json(data);
});
