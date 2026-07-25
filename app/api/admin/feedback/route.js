import { NextResponse } from 'next/server';
import dbApi from '@/src/db.cjs';
import { requireAdmin } from '@/src/session';
import { wrap } from '@/src/http';

// 管理员("作者")查看全部用户提交的反馈
export const GET = wrap(async () => {
  const { response } = await requireAdmin();
  if (response) return response;
  const rows = await dbApi.listAllFeedback();
  return NextResponse.json(rows);
});
