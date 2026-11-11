import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { checkPasswordLimited, lockedBody } from '@/src/passwordGuard';
import dbApi from '@/src/db.cjs';
import { requireSession } from '@/src/session';
import { wrap, readJson, readString, PASSWORD_MAX_BYTES, FORM_BODY_MAX } from '@/src/http';

export const POST = wrap(async (request) => {
  // 被管理员重置过密码的账号只能走这个接口(和 /api/auth/me、退出)，所以放行
  const { session, response } = await requireSession({ allowPasswordChange: true });
  if (response) return response;

  const body = await readJson(request, FORM_BODY_MAX);
  const pw = { trim: false, required: true, emptyMessage: '请输入当前密码和新密码' };
  const currentPassword = readString(body, 'currentPassword', { ...pw, label: '当前密码' });
  const newPassword = readString(body, 'newPassword', { ...pw, label: '新密码', maxBytes: PASSWORD_MAX_BYTES });

  if (newPassword === currentPassword) return NextResponse.json({ error: '新密码不能和当前密码相同' }, { status: 400 });

  const user = await dbApi.findUserById(session.userId);
  if (!user) return NextResponse.json({ error: '当前密码不正确' }, { status: 401 });
  // 带防爆破: 修改密码和注销账号共用一个失败计数(10 次 / 15 分钟，见 src/passwordGuard.js)
  const check = await checkPasswordLimited(user.id, currentPassword, user.password_hash);
  if (check === 'locked') return NextResponse.json(lockedBody(), { status: 429 });
  if (check !== 'ok') return NextResponse.json({ error: '当前密码不正确' }, { status: 401 });

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await dbApi.updatePassword(session.userId, passwordHash);
  return NextResponse.json({ ok: true });
});
