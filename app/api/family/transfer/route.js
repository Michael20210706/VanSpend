import { NextResponse } from 'next/server';
import dbApi from '@/src/db.cjs';
import { requireFamilyCreator } from '@/src/session';
import { wrap, readJson, FORM_BODY_MAX } from '@/src/http';

// 创建者把创建者身份转让给本家庭的另一个成员: body { userId }。
// 转让后原创建者失去邀请/审核/移除/解散/改名的权限，他还没用的家庭邀请码一并作废。
export const POST = wrap(async (request) => {
  const { session, response } = await requireFamilyCreator();
  if (response) return response;

  const body = await readJson(request, FORM_BODY_MAX);
  // 严格要求正整数: 字符串、数组、小数、缺失都是 400
  if (!Number.isInteger(body.userId) || body.userId <= 0) {
    return NextResponse.json({ error: 'userId 必须是正整数' }, { status: 400 });
  }

  const result = await dbApi.transferCreator(session.familyId, session.userId, body.userId);
  if (result === 'forbidden') return NextResponse.json({ error: '无权限' }, { status: 403 });
  if (result === 'self') return NextResponse.json({ error: '不能转让给自己' }, { status: 400 });
  if (result === 'not_member') return NextResponse.json({ error: '只能转让给本家庭的成员' }, { status: 400 });
  return NextResponse.json({ transferred: true });
});
