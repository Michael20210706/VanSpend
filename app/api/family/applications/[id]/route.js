import { NextResponse } from 'next/server';
import dbApi from '@/src/db.cjs';
import { requireSession } from '@/src/session';
import { wrap, parseId } from '@/src/http';

// 申请人撤回自己还在等审核的加入申请。别人的申请、已处理的申请、不存在的申请一律 404
export const DELETE = wrap(async (request, { params }) => {
  const { session, response } = await requireSession();
  if (response) return response;

  const id = parseId((await params).id);
  if (id === null) return NextResponse.json({ error: '无效的 id' }, { status: 400 });

  const ok = await dbApi.withdrawApplication(id, session.userId);
  if (!ok) return NextResponse.json({ error: '申请不存在或已处理' }, { status: 404 });
  return NextResponse.json({ withdrawn: true });
});
