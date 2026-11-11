import { NextResponse } from 'next/server';
import dbApi from '@/src/db.cjs';
import uploadsLib from '@/src/uploads.cjs';
import { requireSession } from '@/src/session';
import { wrap, readJson, IMAGE_BODY_MAX, memberScope, readDateParam } from '@/src/http';

export const GET = wrap(async (request) => {
  const { session, response } = await requireSession();
  if (response) return response;

  const { searchParams } = new URL(request.url);
  const scope = memberScope(session);
  const rows = await dbApi.listReceipts({
    from: readDateParam(searchParams, 'from'),
    to: readDateParam(searchParams, 'to'),
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
  // 保存失败(账号恰好被删导致外键错误、数据库异常等)时，已经写到磁盘上的原图要收回，否则留下没人能访问的孤儿文件
  // 家庭归属(family_id/family_name/family_role/account_type)不从会话取，也不信请求体里的同名字段:
  // saveReceipt 在事务里按数据库当前值盖章(见 src/db.cjs)，这样请求处理期间发生的退出/移除/改名/解散不会留下过期归属
  let id;
  try {
    id = await dbApi.saveReceipt(
      {
        ...receipt,
        user_id: session.userId,
        image_file,
        raw_json: JSON.stringify(raw || { receipt, items }),
      },
      items,
      { stampFamilyFromDb: true }
    );
  } catch (e) {
    if (image_file) uploadsLib.deleteImages([image_file]);
    // 请求处理期间账号被删(注销/管理员删除): 外键找不到用户。按"未登录"处理，而不是 500
    if (e && e.code === 'ER_NO_REFERENCED_ROW_2') return NextResponse.json({ error: '账号不存在或已注销' }, { status: 401 });
    throw e;
  }
  return NextResponse.json({ id });
});
