import { NextResponse } from 'next/server';
import dbApi from '@/src/db.cjs';
import uploadsLib from '@/src/uploads.cjs';
import { requireAdmin } from '@/src/session';
import { wrap, readJson, parseId, FORM_BODY_MAX } from '@/src/http';

// 级联删除该用户名下所有小票/明细(外键 ON DELETE CASCADE)，禁止误删自己导致锁死管理后台
export const DELETE = wrap(async (request, { params }) => {
  const { session, response } = await requireAdmin();
  if (response) return response;

  const id = parseId((await params).id);
  if (id === null) return NextResponse.json({ error: '无效的 id' }, { status: 400 });
  if (id === session.userId) return NextResponse.json({ error: '不能删除自己当前登录的账号' }, { status: 400 });
  const { deleted, images } = await dbApi.deleteUserFull(id, { id: session.userId, username: session.username });
  if (deleted) uploadsLib.deleteImages(images); // 数据库已提交，再删该用户小票的原图文件
  if (!deleted) return NextResponse.json({ error: '用户不存在' }, { status: 404 });
  return NextResponse.json({ deleted });
});

// 调整用户的每日扫描额度档位: 'open'(开放注册档) / 'normal'(正常档)
export const PATCH = wrap(async (request, { params }) => {
  const { session, response } = await requireAdmin();
  if (response) return response;

  const body = await readJson(request, FORM_BODY_MAX);
  if (body.tier !== 'open' && body.tier !== 'normal') {
    return NextResponse.json({ error: 'tier 必须是 open 或 normal' }, { status: 400 });
  }
  const id = parseId((await params).id);
  if (id === null) return NextResponse.json({ error: '无效的 id' }, { status: 400 });
  const found = await dbApi.setScanTier(id, body.tier, { id: session.userId, username: session.username });
  if (!found) return NextResponse.json({ error: '用户不存在' }, { status: 404 });
  return NextResponse.json({ id, tier: body.tier });
});
