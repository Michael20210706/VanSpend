import { NextResponse } from 'next/server';
import dbApi from '@/src/db.cjs';
import { requireSession } from '@/src/session';
import { wrap, parseId, memberScope } from '@/src/http';

export const GET = wrap(async (request, { params }) => {
  const { session, response } = await requireSession();
  if (response) return response;

  const id = parseId((await params).id);
  if (id === null) return NextResponse.json({ error: '无效的 id' }, { status: 400 });
  const scope = memberScope(session);
  const r = await dbApi.getReceipt(id, scope);
  if (!r) return NextResponse.json({ error: '未找到' }, { status: 404 });
  return NextResponse.json(r);
});

export const DELETE = wrap(async (request, { params }) => {
  const { session, response } = await requireSession();
  if (response) return response;

  const id = parseId((await params).id);
  if (id === null) return NextResponse.json({ error: '无效的 id' }, { status: 400 });
  const deleted = await dbApi.deleteReceipt(id, session.userId);
  return NextResponse.json({ deleted });
});
