import { NextResponse } from 'next/server';
import dbApi from '@/src/db.cjs';
import uploadsLib from '@/src/uploads.cjs';
import { requireSession } from '@/src/session';
import { wrap, readJson, IMAGE_BODY_MAX, memberScope } from '@/src/http';

export const GET = wrap(async (request) => {
  const { session, response } = await requireSession();
  if (response) return response;

  const { searchParams } = new URL(request.url);
  const scope = memberScope(session);
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

  const body = await readJson(request, IMAGE_BODY_MAX);
  const { receipt, items, image, raw } = body;
  if (!receipt || !Array.isArray(items)) return NextResponse.json({ error: '数据格式错误' }, { status: 400 });
  if (image) {
    const bad = uploadsLib.checkImage(image);
    if (bad) return NextResponse.json({ error: bad.error }, { status: bad.status });
  }
  const image_file = image ? uploadsLib.saveImage(image) : null;
  // 家庭归属(family_id/family_name/family_role/account_type)不从会话取，也不信请求体里的同名字段:
  // saveReceipt 在事务里按数据库当前值盖章(见 src/db.cjs)，这样请求处理期间发生的退出/移除/改名/解散不会留下过期归属
  const id = await dbApi.saveReceipt(
    {
      ...receipt,
      user_id: session.userId,
      image_file,
      raw_json: JSON.stringify(raw || { receipt, items }),
    },
    items,
    { stampFamilyFromDb: true }
  );
  return NextResponse.json({ id });
});
