import { NextResponse } from 'next/server';
import dbApi from '@/src/db.cjs';
import { requireFamilyCreator } from '@/src/session';
import { wrap, parseId } from '@/src/http';

// 创建者把一个成员移出家庭: 对方变回个人账号，他的小票和明细摘掉家庭归属(跟人走)。
// 只能移除本家庭的其他成员；创建者本人要用"退出"/"解散"
export const DELETE = wrap(async (request, { params }) => {
  const { session, response } = await requireFamilyCreator();
  if (response) return response;

  const id = parseId((await params).id);
  if (id === null) return NextResponse.json({ error: '无效的 id' }, { status: 400 });

  const result = await dbApi.removeMember(session.familyId, session.userId, id);
  if (result === 'forbidden') return NextResponse.json({ error: '无权限' }, { status: 403 });
  if (result === 'is_creator') return NextResponse.json({ error: '不能移除自己；想离开请用"退出家庭"或"解散家庭"' }, { status: 400 });
  if (result === 'not_member') return NextResponse.json({ error: '该用户不是本家庭的成员' }, { status: 404 });
  return NextResponse.json({ removed: true });
});
