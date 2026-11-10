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

// 生成邀请码: 已登录的"正常额度"账号(和管理员)可以生成普通码(只管注册)；家庭创建者可以生成家庭码(注册后直接入家庭)。
// 每个码只能用一次、7 天过期；每人 7 天内最多生成 20 个(不论用没用)。
//
// 开放注册档(scan_tier='open')的账号不能发码: 邀请注册不需要验证码、且给正常额度，
// 如果开放注册的账号也能发码，过一次验证码就能无限滚出免验证码的正常额度账号，等于绕过验证码和开放档的低额度。
// 想发码要先被管理员升到正常档，或由别人邀请进来。
export const POST = wrap(async (request) => {
  const { session, response } = await requireSession();
  if (response) return response;

  if (!session.isAdmin && session.scanTier === 'open') {
    return NextResponse.json({ error: '开放注册的账号暂时不能生成邀请码，请联系管理员升级额度，或让已有用户邀请你' }, { status: 403 });
  }

  const body = await readJson(request, FORM_BODY_MAX);
  const forFamily = body.family === true; // 严格布尔: "false" 之类的字符串不算
  if (forFamily && !(session.familyId && session.isFamilyCreator)) {
    return NextResponse.json({ error: '只有家庭创建者可以生成家庭邀请码' }, { status: 403 });
  }

  const row = await dbApi.createInviteCode(session.userId, { familyId: forFamily ? session.familyId : null });
  if (!row) return NextResponse.json({ error: '最近 7 天生成的邀请码已达上限，请过几天再生成' }, { status: 400 });
  return NextResponse.json(row);
});
