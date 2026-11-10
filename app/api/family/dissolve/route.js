import { NextResponse } from 'next/server';
import dbApi from '@/src/db.cjs';
import { requireFamilyCreator } from '@/src/session';
import { wrap, readJson, FORM_BODY_MAX } from '@/src/http';

// 创建者解散家庭: body { name } 必须和家庭名一字不差(防误操作)。所有成员变回个人账号，
// 每个人的小票和明细摘掉家庭归属但所有者不变；待审申请和家庭邀请码一并删除；家庭名可以重新使用。
export const POST = wrap(async (request) => {
  const { session, response } = await requireFamilyCreator();
  if (response) return response;

  const body = await readJson(request, FORM_BODY_MAX);
  if (typeof body.name !== 'string') return NextResponse.json({ error: '请输入家庭名称以确认解散' }, { status: 400 });

  const result = await dbApi.dissolveFamily(session.familyId, session.userId, body.name);
  if (result === 'forbidden') return NextResponse.json({ error: '无权限' }, { status: 403 });
  if (result === 'name_mismatch') return NextResponse.json({ error: '输入的家庭名称不对，未解散' }, { status: 400 });
  return NextResponse.json({ dissolved: true });
});
