import { NextResponse } from 'next/server';
import dbApi from '@/src/db.cjs';
import { requireSession } from '@/src/session';
import { wrap, parseId } from '@/src/http';

// 作废自己生成的、还没被使用的码。别人的码一律当不存在(404)
export const DELETE = wrap(async (request, { params }) => {
  const { session, response } = await requireSession();
  if (response) return response;

  const id = parseId((await params).id);
  if (id === null) return NextResponse.json({ error: '无效的 id' }, { status: 400 });
  const result = await dbApi.revokeInviteCode(id, session.userId);
  if (result === 'not_found') return NextResponse.json({ error: '未找到' }, { status: 404 });
  if (result === 'used') return NextResponse.json({ error: '该邀请码已被使用，不能作废' }, { status: 400 });
  return NextResponse.json({ revoked: true });
});
