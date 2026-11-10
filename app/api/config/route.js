import { NextResponse } from 'next/server';
import openrouterLib from '@/src/openrouter.cjs';
import { requireSession } from '@/src/session';
import { wrap } from '@/src/http';

// 只给已登录用户: 里面的 hasKey(服务端有没有配置 OpenRouter Key)和模型名是部署内部状态，
// 公网部署时不该透给匿名访客(前端本来也只在登录后才请求它)
export const GET = wrap(async () => {
  const { response } = await requireSession();
  if (response) return response;
  const { config } = openrouterLib;
  return NextResponse.json({
    model: config.model,
    categories: config.categories,
    currency: config.currency,
    region: config.region,
    hasKey: !!process.env.OPENROUTER_API_KEY,
  });
});
