import { NextResponse } from 'next/server';
import dbApi from '@/src/db.cjs';
import { requireAdmin } from '@/src/session';
import { wrap } from '@/src/http';

// 管理员操作日志，只读(这个路由没有写/改/删方法)。最新在前，默认 200 条、最多 500 条
export const GET = wrap(async (request) => {
  const { response } = await requireAdmin();
  if (response) return response;
  const limit = new URL(request.url).searchParams.get('limit');
  return NextResponse.json(await dbApi.listAuditLog({ limit }));
});
