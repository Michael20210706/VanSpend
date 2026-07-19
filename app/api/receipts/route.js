import { NextResponse } from 'next/server';
import dbApi from '@/src/db.cjs';
import { saveImage } from '@/src/uploads.cjs';
import { requireSession } from '@/src/session';
import { wrap } from '@/src/http';

export const GET = wrap(async (request) => {
  const { session, response } = await requireSession();
  if (response) return response;

  const { searchParams } = new URL(request.url);
  const rows = await dbApi.listReceipts({
    from: searchParams.get('from') || undefined,
    to: searchParams.get('to') || undefined,
    search: searchParams.get('search') || undefined,
    userId: session.userId,
  });
  return NextResponse.json(rows);
});

// 确认后保存
export const POST = wrap(async (request) => {
  const { session, response } = await requireSession();
  if (response) return response;

  const body = await request.json();
  const { receipt, items, image, raw } = body;
  if (!receipt || !Array.isArray(items)) return NextResponse.json({ error: '数据格式错误' }, { status: 400 });
  const image_file = image ? saveImage(image) : null;
  const id = await dbApi.saveReceipt(
    { ...receipt, user_id: session.userId, image_file, raw_json: JSON.stringify(raw || { receipt, items }) },
    items
  );
  return NextResponse.json({ id });
});
