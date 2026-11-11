import { NextResponse } from 'next/server';
import dbApi from '@/src/db.cjs';
import { requireFamilyCreator } from '@/src/session';
import { wrap, readJson, readString, FORM_BODY_MAX } from '@/src/http';

// 创建者邀请一个已注册用户直接入群，立即生效(邀请人本身即审核人)
export const POST = wrap(async (request) => {
  const { session, response } = await requireFamilyCreator();
  if (response) return response;

  const body = await readJson(request, FORM_BODY_MAX);
  const username = readString(body, 'username', { label: '用户名', required: true, max: 100, noControl: true, emptyMessage: '请填写要邀请的用户名' });
  if (username === session.username) return NextResponse.json({ error: '不能邀请自己' }, { status: 400 });

  const target = await dbApi.findUserByUsername(username);
  if (!target) return NextResponse.json({ error: '用户不存在' }, { status: 400 });
  if (target.family_id) return NextResponse.json({ error: '该用户已经在一个家庭中' }, { status: 400 });

  const ok = await dbApi.inviteMember(session.familyId, username);
  if (!ok) return NextResponse.json({ error: '邀请失败，请重试' }, { status: 400 });
  return NextResponse.json({ invited: true });
});
