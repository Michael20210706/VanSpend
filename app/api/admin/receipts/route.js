import { NextResponse } from 'next/server';
import dbApi from '@/src/db.cjs';
import { requireAdmin } from '@/src/session';
import { wrap, readDateParam, readIdParam } from '@/src/http';

// 与 /api/receipts 的区别: userId 可选，不传就是全部用户的小票
export const GET = wrap(async (request) => {
  const { response } = await requireAdmin();
  if (response) return response;

  const { searchParams } = new URL(request.url);
  const userId = readIdParam(searchParams, 'userId');
  const rows = await dbApi.listReceipts({
    from: readDateParam(searchParams, 'from'),
    to: readDateParam(searchParams, 'to'),
    search: searchParams.get('search') || undefined,
    scope: userId ? { userId } : undefined,
  });
  return NextResponse.json(rows);
});
