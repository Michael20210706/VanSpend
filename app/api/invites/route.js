import { NextResponse } from 'next/server';
import dbApi from '@/src/db.cjs';
import { requireSession } from '@/src/session';
import { wrap, readJson, FORM_BODY_MAX } from '@/src/http';

// 我生成的邀请码(带状态)。?kind=family 只看家庭码，?kind=personal 只看普通码
export const GET = wrap(async (request) => {
  const { session, response } = await requireSession();
  if (response) return response;
  const kind = new URL(request.url).searchParams.get('kind');
  const rows = await dbApi.listInviteCodes(session.userId, kind === 'family' || kind === 'personal' ? kind : undefined);
  return NextResponse.json(rows);
});

// 生成邀请码: 任何已登录用户都可以生成普通码(只管注册)；家庭创建者可以生成家庭码(注册后直接入家庭)。
// 每个码只能用一次、7 天过期；未使用的有效码每人最多 20 个。
export const POST = wrap(async (request) => {
  const { session, response } = await requireSession();
  if (response) return response;

  const body = await readJson(request, FORM_BODY_MAX);
  const forFamily = body.family === true; // 严格布尔: "false" 之类的字符串不算
  if (forFamily && !(session.familyId && session.isFamilyCreator)) {
    return NextResponse.json({ error: '只有家庭创建者可以生成家庭邀请码' }, { status: 403 });
  }

  const row = await dbApi.createInviteCode(session.userId, { familyId: forFamily ? session.familyId : null });
  if (!row) return NextResponse.json({ error: '未使用的邀请码已达上限(20 个)，请先作废一些再生成' }, { status: 400 });
  return NextResponse.json(row);
});
