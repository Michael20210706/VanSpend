// P5 验证提出: 验证码签名密钥在 SESSION_SECRET 缺失/过短时不能回退到写死的常量(否则可伪造答案已知的 token)
import crypto from 'crypto';
import { describe, it, expect, afterEach, vi } from 'vitest';

const original = process.env.SESSION_SECRET;
afterEach(() => {
  process.env.SESSION_SECRET = original;
  vi.resetModules();
});

// 用某个密钥伪造一个"答案是 7、5 分钟内有效"的 token(格式同 src/captcha.cjs: 过期时间:nonce:答案的 HMAC)
function forge(secret) {
  const hmac = (s) => crypto.createHmac('sha256', secret).update(s).digest('hex');
  const nonce = crypto.randomBytes(8).toString('hex');
  const payload = `${Date.now() + 5 * 60 * 1000}:${nonce}:${hmac(`a:${nonce}:7`)}`;
  return `${Buffer.from(payload).toString('base64url')}.${hmac(payload)}`;
}

async function freshCaptcha(secret) {
  if (secret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = secret;
  vi.resetModules();
  return (await import('@/src/captcha.cjs')).default;
}

describe('验证码签名密钥', () => {
  it('SESSION_SECRET 未设置: 用旧的写死常量伪造的 token 不再通过；自己签发的仍能校验', async () => {
    const captcha = await freshCaptcha(undefined);
    expect(captcha.verify(forge('vanspend-captcha-fallback-secret'), '7')).toBe(false);
    const { token } = captcha.generate();
    expect(captcha.verify(token, 'definitely-wrong')).toBe(false);
  });

  it('SESSION_SECRET 是 .env.example 的占位值(短于 32 位): 用占位值伪造的 token 不通过', async () => {
    const captcha = await freshCaptcha('change-me-to-a-random-string');
    expect(captcha.verify(forge('change-me-to-a-random-string'), '7')).toBe(false);
  });

  it('SESSION_SECRET 合格(>= 32 位): 用它签的 token 通过，答案错则不通过', async () => {
    const secret = 'a-proper-secret-that-is-long-enough-123456';
    const captcha = await freshCaptcha(secret);
    expect(captcha.verify(forge(secret), '7')).toBe(true);
    expect(captcha.verify(forge(secret), '8')).toBe(false);
  });

  it('密钥不同则签名不通用(换一个合格密钥伪造 → 不通过)', async () => {
    const captcha = await freshCaptcha('a-proper-secret-that-is-long-enough-123456');
    expect(captcha.verify(forge('another-proper-secret-that-is-long-enough-1'), '7')).toBe(false);
  });
});
