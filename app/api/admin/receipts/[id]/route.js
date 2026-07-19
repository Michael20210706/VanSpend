import { NextResponse } from 'next/server';
import dbApi from '@/src/db.cjs';
import { requireAdmin } from '@/src/session';
import { wrap } from '@/src/http';

// 与 /api/receipts/[id] 的区别: 不按 userId 过滤，可以查看/删除任意用户的小票
export const GET = wrap(async (request, { params }) => {
  const { response } = await requireAdmin();
  if (response) return response;

  const { id } = await params;
  const r = await dbApi.getReceipt(+id);
  if (!r) return NextResponse.json({ error: '未找到' }, { status: 404 });
  return NextResponse.json(r);
});

export const DELETE = wrap(async (request, { params }) => {
  const { response } = await requireAdmin();
  if (response) return response;

  const { id } = await params;
  const deleted = await dbApi.deleteReceipt(+id);
  return NextResponse.json({ deleted });
});
