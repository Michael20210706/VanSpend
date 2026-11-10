import { NextResponse } from 'next/server';
import openrouterLib from '@/src/openrouter.cjs';
import uploadsLib from '@/src/uploads.cjs';
import { requireSession } from '@/src/session';
import { wrap, readJson, IMAGE_BODY_MAX } from '@/src/http';

// 仅识别，不入库，返回给前端确认/编辑
export const POST = wrap(async (request) => {
  const { response } = await requireSession();
  if (response) return response;

  const body = await readJson(request, IMAGE_BODY_MAX);
  const { image } = body;
  if (!image) return NextResponse.json({ error: '缺少图片' }, { status: 400 });
  // 先挡非法/超大图，再调用(计费的)OpenRouter
  const bad = uploadsLib.checkImage(image);
  if (bad) return NextResponse.json({ error: bad.error }, { status: bad.status });
  const result = await openrouterLib.scanReceipt(image);
  return NextResponse.json(result);
});
