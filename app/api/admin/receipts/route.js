import { NextResponse } from 'next/server';
import dbApi from '@/src/db.cjs';
import { requireAdmin } from '@/src/session';
import { wrap } from '@/src/http';

// 与 /api/receipts 的区别: userId 可选，不传就是全部用户的小票
export const GET = wrap(async (request) => {
  const { response } = await requireAdmin();
  if (response) return response;

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  const rows = await dbApi.listReceipts({
    from: searchParams.get('from') || undefined,
    to: searchParams.get('to') || undefined,
    search: searchParams.get('search') || undefined,
    scope: userId ? { userId: +userId } : undefined,
  });
  return NextResponse.json(rows);
});
