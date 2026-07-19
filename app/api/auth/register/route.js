import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import dbApi from '@/src/db.cjs';
import { getSession } from '@/src/session';
import { wrap } from '@/src/http';

export const POST = wrap(async (request) => {
  const body = await request.json();
  const username = (body.username || '').trim();
  const password = body.password || '';
  if (!username || !password) return NextResponse.json({ error: '用户名和密码不能为空' }, { status: 400 });
  if (await dbApi.findUserByUsername(username)) return NextResponse.json({ error: '用户名已存在' }, { status: 400 });
  const isFirstUser = (await dbApi.countUsers()) === 0;
  const passwordHash = await bcrypt.hash(password, 10);
  const id = await dbApi.createUser(username, passwordHash);
  if (isFirstUser) await dbApi.backfillOwnerlessReceipts(id); // 迁移: 功能上线前的旧数据归给首个账号

  const session = await getSession();
  session.userId = id;
  session.username = username;
  session.isAdmin = false; // 自助注册永远不能是管理员，只能通过 ADMIN_USERNAME/ADMIN_PASSWORD 启动时初始化
  await session.save();
  return NextResponse.json({ id, username, isAdmin: false });
});
