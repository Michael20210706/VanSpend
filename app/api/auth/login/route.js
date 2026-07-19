import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import dbApi from '@/src/db.cjs';
import { getSession } from '@/src/session';
import { wrap } from '@/src/http';

export const POST = wrap(async (request) => {
  const body = await request.json();
  const username = (body.username || '').trim();
  const password = body.password || '';
  const user = username ? await dbApi.findUserByUsername(username) : null;
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 });
  }

  const session = await getSession();
  session.userId = user.id;
  session.username = user.username;
  session.isAdmin = !!user.is_admin;
  await session.save();
  return NextResponse.json({ id: user.id, username: user.username, isAdmin: session.isAdmin });
});
