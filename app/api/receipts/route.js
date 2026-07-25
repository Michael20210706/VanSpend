import { NextResponse } from 'next/server';
import dbApi from '@/src/db.cjs';
import { saveImage } from '@/src/uploads.cjs';
import { requireSession } from '@/src/session';
import { wrap } from '@/src/http';

export const GET = wrap(async (request) => {
  const { session, response } = await requireSession();
  if (response) return response;

  const { searchParams } = new URL(request.url);
  const scope = session.familyId ? { familyId: session.familyId } : { userId: session.userId };
  const rows = await dbApi.listReceipts({
    from: searchParams.get('from') || undefined,
    to: searchParams.get('to') || undefined,
    search: searchParams.get('search') || undefined,
    scope,
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
    {
      ...receipt,
      user_id: session.userId,
      family_id: session.familyId || null,
      family_name: session.familyName || null,
      family_role: session.familyRole || null,
      account_type: session.accountType || 'individual',
      image_file,
      raw_json: JSON.stringify(raw || { receipt, items }),
    },
    items
  );
  return NextResponse.json({ id });
});
