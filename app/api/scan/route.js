import { NextResponse } from 'next/server';
import openrouterLib from '@/src/openrouter.cjs';
import { requireSession } from '@/src/session';
import { wrap } from '@/src/http';

// 仅识别，不入库，返回给前端确认/编辑
export const POST = wrap(async (request) => {
  const { response } = await requireSession();
  if (response) return response;

  const body = await request.json();
  const { image } = body;
  if (!image) return NextResponse.json({ error: '缺少图片' }, { status: 400 });
  const result = await openrouterLib.scanReceipt(image);
  return NextResponse.json(result);
});
