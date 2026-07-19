import { NextResponse } from 'next/server';
import dbApi from '@/src/db.cjs';
import { requireAdmin } from '@/src/session';
import { wrap } from '@/src/http';

// 单用户视图里没有这个维度: 各用户花费排行
export const GET = wrap(async (request) => {
  const { response } = await requireAdmin();
  if (response) return response;

  const { searchParams } = new URL(request.url);
  const data = await dbApi.statsByUser(searchParams.get('from') || undefined, searchParams.get('to') || undefined);
  return NextResponse.json(data);
});
