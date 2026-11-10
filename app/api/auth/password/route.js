import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import dbApi from '@/src/db.cjs';
import { requireSession } from '@/src/session';
import { wrap, readJson, FORM_BODY_MAX } from '@/src/http';

export const POST = wrap(async (request) => {
  // 被管理员重置过密码的账号只能走这个接口(和 /api/auth/me、退出)，所以放行
  const { session, response } = await requireSession({ allowPasswordChange: true });
  if (response) return response;

  const body = await readJson(request, FORM_BODY_MAX);
  const currentPassword = body.currentPassword || '';
  const newPassword = body.newPassword || '';
  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: '请输入当前密码和新密码' }, { status: 400 });
  }

  if (newPassword === currentPassword) return NextResponse.json({ error: '新密码不能和当前密码相同' }, { status: 400 });

  const user = await dbApi.findUserById(session.userId);
  if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) {
    return NextResponse.json({ error: '当前密码不正确' }, { status: 401 });
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await dbApi.updatePassword(session.userId, passwordHash);
  return NextResponse.json({ ok: true });
});
