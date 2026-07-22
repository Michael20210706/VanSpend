import { NextResponse } from 'next/server';
import captchaApi from '@/src/captcha.cjs';
import { wrap } from '@/src/http';

// 公开路由：注册表单加载/切换到注册模式时调用，出题
export const GET = wrap(async () => {
  const { image, token } = captchaApi.generate();
  return NextResponse.json({ image, token });
});
