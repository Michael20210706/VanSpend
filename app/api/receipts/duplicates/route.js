import { NextResponse } from 'next/server';
import dbApi from '@/src/db.cjs';
import { requireSession } from '@/src/session';
import { wrap, memberScope } from '@/src/http';

// 保存前的重复提示: 在可见范围(家庭 + 自己的，或只有自己的)内找同商家 + 同日期 + 同总额的小票。只提示，不拦截保存。
export const GET = wrap(async (request) => {
  const { session, response } = await requireSession();
  if (response) return response;

  const sp = new URL(request.url).searchParams;
  const store = (sp.get('store') || '').trim();
  const date = sp.get('date') || '';
  const totalRaw = sp.get('total');
  const total = totalRaw === null || totalRaw.trim() === '' ? NaN : Number(totalRaw);
  if (!store || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(total) || Math.abs(total) > 99999999) {
    return NextResponse.json({ error: '参数错误' }, { status: 400 });
  }
  const rows = await dbApi.findDuplicateReceipts({ store, purchased_at: date, total }, memberScope(session));
  return NextResponse.json(rows);
});
