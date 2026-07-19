import { NextResponse } from 'next/server';
import dbApi from '@/src/db.cjs';
import { requireAdmin } from '@/src/session';
import { wrap } from '@/src/http';

// 级联删除该用户名下所有小票/明细(外键 ON DELETE CASCADE)，禁止误删自己导致锁死管理后台
export const DELETE = wrap(async (request, { params }) => {
  const { session, response } = await requireAdmin();
  if (response) return response;

  const { id } = await params;
  if (+id === session.userId) return NextResponse.json({ error: '不能删除自己当前登录的账号' }, { status: 400 });
  const deleted = await dbApi.deleteUser(+id);
  return NextResponse.json({ deleted });
});
