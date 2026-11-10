import { NextResponse } from 'next/server';
import dbApi from '@/src/db.cjs';
import { requireSession } from '@/src/session';
import receiptInput from '@/src/receiptInput.cjs';
import { wrap, parseId, memberScope, readJson, EDIT_BODY_MAX } from '@/src/http';

export const GET = wrap(async (request, { params }) => {
  const { session, response } = await requireSession();
  if (response) return response;

  const id = parseId((await params).id);
  if (id === null) return NextResponse.json({ error: '无效的 id' }, { status: 400 });
  const scope = memberScope(session);
  const r = await dbApi.getReceipt(id, scope);
  if (!r) return NextResponse.json({ error: '未找到' }, { status: 404 });
  return NextResponse.json(r);
});

export const DELETE = wrap(async (request, { params }) => {
  const { session, response } = await requireSession();
  if (response) return response;

  const id = parseId((await params).id);
  if (id === null) return NextResponse.json({ error: '无效的 id' }, { status: 400 });
  const deleted = await dbApi.deleteReceipt(id, session.userId);
  return NextResponse.json({ deleted });
});

// 保存后编辑: 仅所有者(与删除同权限)。不是自己的/不存在一律 404。
// 小计与总额由服务端按明细重算(见 src/receiptInput.cjs)，请求体里的 subtotal/total 被忽略。
export const PUT = wrap(async (request, { params }) => {
  const { session, response } = await requireSession();
  if (response) return response;

  const id = parseId((await params).id);
  if (id === null) return NextResponse.json({ error: '无效的 id' }, { status: 400 });
  const body = await readJson(request, EDIT_BODY_MAX);
  const existing = await dbApi.getReceipt(id, { userId: session.userId });
  if (!existing) return NextResponse.json({ error: '未找到' }, { status: 404 });
  const v = receiptInput.validateEdit(body, existing.currency);
  if (v.error) return NextResponse.json({ error: v.error }, { status: 400 });
  const ok = await dbApi.updateReceipt(id, session.userId, v.receipt, v.items);
  if (!ok) return NextResponse.json({ error: '未找到' }, { status: 404 });
  return NextResponse.json(await dbApi.getReceipt(id, { userId: session.userId }));
});
