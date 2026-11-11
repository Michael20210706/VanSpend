// 上线后加固: 开放注册的全站总量上限、开放档识别的全站总预算、安全响应头
import { describe, it, expect, vi, afterEach } from 'vitest';
import dbApi from '@/src/db.cjs';
import captchaApi from '@/src/captcha.cjs';
import openrouterLib from '@/src/openrouter.cjs';
import * as registerRoute from '@/app/api/auth/register/route.js';
import * as scanRoute from '@/app/api/scan/route.js';
import * as invitesRoute from '@/app/api/invites/route.js';
import nextConfig, { securityHeaders } from '../next.config.js';
import { makeUser, loginAs, logout, req, uniq } from './helpers.js';

afterEach(() => vi.restoreAllMocks());

const cfg = openrouterLib.config.openRegistration;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function realCaptcha() {
  const { token } = captchaApi.generate();
  for (let a = -9; a <= 18; a++) if (captchaApi.verify(token, String(a))) return { token, answer: String(a) };
  throw new Error('找不到答案');
}
const reg = (ip) => {
  const { token, answer } = realCaptcha();
  return registerRoute.POST(req('/api/auth/register', {
    method: 'POST', body: { username: uniq('ol'), password: 'pw123456', captchaToken: token, captchaAnswer: answer },
    headers: ip ? { 'cf-connecting-ip': ip } : {},
  }));
};
const seed = (n, ipFn, ageSql = 'NOW()') =>
  dbApi.pool.query(`INSERT INTO signup_attempts (ip, created_at) VALUES ${Array(n).fill(`(?, ${ageSql})`).join(',')}`, Array.from({ length: n }, (_, i) => ipFn(i)));

describe('开放注册的全站总量上限', () => {
  it('配置里有这三个上限，且都是正整数', () => {
    for (const k of ['maxAttemptsPerIpPerDay', 'maxAttemptsPerDay', 'maxOpenScansPerDay']) expect(Number.isInteger(cfg[k]) && cfg[k] > 0, k).toBe(true);
    expect(cfg.maxAttemptsPerDay).toBeGreaterThan(cfg.maxAttemptsPerIpPerDay);
  });

  it('全站已达上限(来自很多不同 IP)→ 新的开放注册 429 并提示名额已满，没建号；总量上限内仍可注册', async () => {
    logout();
    await seed(cfg.maxAttemptsPerDay - 1, (i) => `10.1.${(i / 200) | 0}.${i % 200}`);
    expect((await reg('10.9.9.9')).status).toBe(200); // 第 maxAttemptsPerDay 个，刚好还行
    logout();
    const res = await reg('10.9.9.10');
    expect(res.status).toBe(429);
    expect((await res.json()).error).toContain('名额已满');
    const [[{ n }]] = await dbApi.pool.query('SELECT COUNT(*) n FROM signup_attempts');
    expect(n).toBe(cfg.maxAttemptsPerDay); // 被拒的那次撤销了自己那一笔
  });

  it('超过 24 小时的记录不占总量名额', async () => {
    logout();
    await seed(cfg.maxAttemptsPerDay + 5, (i) => `10.2.0.${i % 250}`, 'NOW() - INTERVAL 25 HOUR');
    expect((await reg('10.9.9.11')).status).toBe(200);
  });

  it('取不到 IP 的请求也受总量限制', async () => {
    logout();
    await seed(cfg.maxAttemptsPerDay, (i) => `10.3.0.${i % 250}`);
    expect((await reg()).status).toBe(429);
  });

  it('同时超过 IP 上限和总量上限时，提示的是"这个网络"(更具体的那个)', async () => {
    logout();
    const ip = '10.4.4.4';
    await seed(cfg.maxAttemptsPerDay, () => ip);
    const res = await reg(ip);
    expect(res.status).toBe(429);
    expect((await res.json()).error).toContain('这个网络');
  });

  it('邀请码注册不受总量上限影响', async () => {
    const inviter = await makeUser();
    await loginAs(inviter);
    const { code } = await (await invitesRoute.POST(req('/api/invites', { method: 'POST', body: {} }))).json();
    logout();
    await seed(cfg.maxAttemptsPerDay, (i) => `10.5.0.${i % 250}`);
    const res = await registerRoute.POST(req('/api/auth/register', { method: 'POST', body: { username: uniq('inv'), password: 'pw123456', inviteCode: code } }));
    expect(res.status).toBe(200);
  });
});

describe('开放档识别的全站总预算', () => {
  const scan = () => scanRoute.POST(req('/api/scan', { method: 'POST', body: { image: PNG } }));
  const mockScan = () => vi.spyOn(openrouterLib, 'scanReceipt').mockResolvedValue({ receipt: {}, items: [], raw: {} });
  const seedScans = async (n, tier) => {
    const u = await makeUser({ tier });
    await dbApi.pool.query(`INSERT INTO scan_log (user_id) VALUES ${Array(n).fill('(?)').join(',')}`, Array(n).fill(u.id));
  };

  it('开放档账号合计用满预算 → 开放档账号再识别 429(不调用 OpenRouter)，提示邀请账号不受限', async () => {
    const spy = mockScan();
    // 用很多个开放档账号把总预算占满(每个账号自己都没超 3 次)
    const per = 2;
    for (let i = 0; i < Math.ceil(cfg.maxOpenScansPerDay / per); i++) await seedScans(per, 'open');
    const u = await makeUser({ tier: 'open' });
    await loginAs(u);
    const res = await scan();
    expect(res.status).toBe(429);
    expect((await res.json()).error).toContain('总额度');
    expect(spy).not.toHaveBeenCalled();
    const [[{ n }]] = await dbApi.pool.query('SELECT COUNT(*) n FROM scan_log WHERE user_id = ?', [u.id]);
    expect(n).toBe(0); // 被拒的不留记录
  });

  it('同样的情况下，正常档账号和管理员照常识别', async () => {
    mockScan();
    for (let i = 0; i < Math.ceil(cfg.maxOpenScansPerDay / 2); i++) await seedScans(2, 'open');
    await loginAs(await makeUser({ tier: 'normal' }));
    expect((await scan()).status).toBe(200);
    await loginAs(await makeUser({ admin: true }));
    expect((await scan()).status).toBe(200);
  });

  it('预算边界: 总数正好等于上限时还能识别(第 150 次)，再来一次(第 151 次)被拒', async () => {
    mockScan();
    await seedScans(cfg.maxOpenScansPerDay - 2, 'open'); // 另一个账号(只用来占预算，不受 3 次限制约束这里直接造数)
    const u = await makeUser({ tier: 'open' });
    await loginAs(u);
    expect((await scan()).status).toBe(200); // 预算已用 maxOpenScansPerDay - 1
    expect((await scan()).status).toBe(200); // 正好 maxOpenScansPerDay
    expect((await scan()).status).toBe(429); // 超出，且是总预算(自己才用了 2 次，没到 3 次)
  });

  it('管理员的识别记录不占开放预算', async () => {
    mockScan();
    const admin = await makeUser({ admin: true });
    await dbApi.pool.query(`INSERT INTO scan_log (user_id) VALUES ${Array(cfg.maxOpenScansPerDay + 10).fill('(?)').join(',')}`, Array(cfg.maxOpenScansPerDay + 10).fill(admin.id));
    await dbApi.pool.query("UPDATE users SET scan_tier = 'open' WHERE id = ?", [admin.id]); // 即使管理员账号的档位字段是 open 也不算
    await loginAs(await makeUser({ tier: 'open' }));
    expect((await scan()).status).toBe(200);
  });

  it('预算没用满时，开放档账号照常识别(各自 3 次的限制不变)', async () => {
    mockScan();
    const u = await makeUser({ tier: 'open' });
    await loginAs(u);
    for (let i = 0; i < 3; i++) expect((await scan()).status).toBe(200);
    expect((await scan()).status).toBe(429);
  });

  it('只数 24 小时内的、开放档的识别；正常档账号的识别不占开放预算', async () => {
    mockScan();
    for (let i = 0; i < Math.ceil(cfg.maxOpenScansPerDay / 2) + 2; i++) {
      const u = await makeUser({ tier: 'normal' });
      await dbApi.pool.query('INSERT INTO scan_log (user_id) VALUES (?), (?)', [u.id, u.id]);
    }
    const old = await makeUser({ tier: 'open' });
    await dbApi.pool.query(`INSERT INTO scan_log (user_id, created_at) VALUES ${Array(cfg.maxOpenScansPerDay + 5).fill('(?, NOW() - INTERVAL 25 HOUR)').join(',')}`, Array(cfg.maxOpenScansPerDay + 5).fill(old.id));
    await loginAs(await makeUser({ tier: 'open' }));
    expect((await scan()).status).toBe(200);
  });
});

describe('安全响应头', () => {
  const find = (hs, key) => hs.find((h) => h.key === key);

  it('生产环境: 基础头 + CSP；CSP 禁止外部脚本、外部连接、被嵌入、<object>', () => {
    const hs = securityHeaders('production');
    expect(find(hs, 'X-Content-Type-Options').value).toBe('nosniff');
    expect(find(hs, 'X-Frame-Options').value).toBe('DENY');
    expect(find(hs, 'Referrer-Policy').value).toBe('same-origin');
    expect(find(hs, 'Strict-Transport-Security').value).toMatch(/^max-age=\d+$/);
    expect(find(hs, 'Strict-Transport-Security').value).not.toMatch(/includeSubDomains|preload/);
    expect(find(hs, 'Permissions-Policy').value).toContain('camera=()');
    const csp = find(hs, 'Content-Security-Policy').value;
    for (const d of ["default-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"]) expect(csp).toContain(d);
    // 唯一放行的外部来源是 Cloudflare Web Analytics 的两个确切主机名: 脚本 + 数据上报
    expect(csp).toContain("script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com;");
    expect(csp).toContain("connect-src 'self' https://cloudflareinsights.com;");
    expect(csp.match(/https?:\/\/[^\s;]+/g).sort()).toEqual(['https://cloudflareinsights.com', 'https://static.cloudflareinsights.com']);
    expect(csp).not.toMatch(/unsafe-eval|\*/); // 没有通配、没有 eval
    expect(csp).toContain('img-src');
    expect(csp).toContain('data:'); // 验证码图片和上传预览是 data URL
  });

  it('开发环境不加 CSP(next dev 需要 eval)，但仍有基础头', () => {
    const hs = securityHeaders('development');
    expect(find(hs, 'Content-Security-Policy')).toBeUndefined();
    expect(find(hs, 'X-Frame-Options')).toBeDefined();
  });

  it('next.config 的 headers() 对所有路径生效', async () => {
    const rules = await nextConfig.headers();
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe('/:path*');
    expect(rules[0].headers.length).toBeGreaterThanOrEqual(6);
    expect(nextConfig.output).toBe('standalone');
  });
});
