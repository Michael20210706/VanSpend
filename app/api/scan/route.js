import { NextResponse } from 'next/server';
import openrouterLib from '@/src/openrouter.cjs';
import dbApi from '@/src/db.cjs';
import uploadsLib from '@/src/uploads.cjs';
import { requireSession } from '@/src/session';
import { wrap, readJson, IMAGE_BODY_MAX } from '@/src/http';

// 仅识别，不入库，返回给前端确认/编辑
export const POST = wrap(async (request) => {
  const { session, response } = await requireSession();
  if (response) return response;

  const body = await readJson(request, IMAGE_BODY_MAX);
  const { image } = body;
  if (!image) return NextResponse.json({ error: '缺少图片' }, { status: 400 });
  // 先挡非法/超大图，再调用(计费的)OpenRouter
  const bad = uploadsLib.checkImage(image);
  if (bad) return NextResponse.json({ error: bad.error }, { status: bad.status });

  // 每日扫描额度(滚动 24 小时): 管理员不限；其余按档位 open/normal(config.json scanQuota)。
  // 先预占一条 scan_log 再调用 OpenRouter，成功失败都记(失败照样收费)，超额返回 429 且不调用
  const quota = openrouterLib.config.scanQuota;
  const limit = session.isAdmin ? null : (quota[session.scanTier] ?? quota.normal);
  const slot = await dbApi.reserveScan(session.userId, openrouterLib.config.model, limit);
  if (!slot.ok) {
    return NextResponse.json({ error: `今日识别次数已用完(24 小时内最多 ${limit} 次)，如需更多额度请联系管理员` }, { status: 429 });
  }
  try {
    const result = await openrouterLib.scanReceipt(image);
    await dbApi.finishScan(slot.id, true);
    return NextResponse.json(result);
  } catch (e) {
    await dbApi.finishScan(slot.id, false);
    throw e;
  }
});
