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

  const family = user.family_id ? await dbApi.findFamilyById(user.family_id) : null;

  const session = await getSession();
  session.userId = user.id;
  session.username = user.username;
  session.isAdmin = !!user.is_admin;
  session.familyId = family ? family.id : undefined;
  session.familyName = family ? family.name : undefined;
  session.familyRole = user.family_role || undefined;
  session.accountType = user.account_type;
  session.isFamilyCreator = family ? family.creator_id === user.id : false;
  await session.save();
  return NextResponse.json({
    id: user.id, username: user.username, isAdmin: session.isAdmin,
    familyId: session.familyId || null, familyName: session.familyName || null,
    familyRole: session.familyRole || null, accountType: session.accountType,
    isFamilyCreator: session.isFamilyCreator,
  });
});
