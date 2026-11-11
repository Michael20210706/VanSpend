// 系统边界的输入校验: 非字符串 → 400(不是 500)、超长 → 400、密码 72 字节、日期/id 查询参数、登录耗时拉平、500 不泄露内部报错
// (issue #20 #21 #27 #29)
import { describe, it, expect, vi, afterEach } from 'vitest';
import bcrypt from 'bcryptjs';
import dbApi from '@/src/db.cjs';
import captchaApi from '@/src/captcha.cjs';
import { wrap } from '@/src/http';
import * as familyRoute from '@/app/api/family/route.js';
import * as applyRoute from '@/app/api/family/apply/route.js';
import * as inviteRoute from '@/app/api/family/invite/route.js';
import * as feedbackRoute from '@/app/api/feedback/route.js';
import * as passwordRoute from '@/app/api/auth/password/route.js';
import * as loginRoute from '@/app/api/auth/login/route.js';
import * as registerRoute from '@/app/api/auth/register/route.js';
import * as invitesRoute from '@/app/api/invites/route.js';
import * as receiptsRoute from '@/app/api/receipts/route.js';
import * as overviewRoute from '@/app/api/stats/overview/route.js';
import * as categoryRoute from '@/app/api/stats/category/route.js';
import * as monthlyRoute from '@/app/api/stats/monthly/route.js';
import * as subcategoryRoute from '@/app/api/stats/subcategory/route.js';
import * as adminReceiptsRoute from '@/app/api/admin/receipts/route.js';
import * as adminOverviewRoute from '@/app/api/admin/stats/overview/route.js';
import * as adminCategoryRoute from '@/app/api/admin/stats/category/route.js';
import * as adminMonthlyRoute from '@/app/api/admin/stats/monthly/route.js';
import * as adminSubcategoryRoute from '@/app/api/admin/stats/subcategory/route.js';
import * as adminByUserRoute from '@/app/api/admin/stats/by-user/route.js';
import * as adminAuditRoute from '@/app/api/admin/audit/route.js';
import { makeUser, makeFamily, loginAs, logout, req, uniq } from './helpers.js';

afterEach(() => vi.restoreAllMocks());

const post = (route, url, body, headers) => route.POST(req(url, { method: 'POST', body, headers }));
const NON_STRINGS = [123, ['a'], { a: 1 }, true];

async function expect400(res) {
  expect(res.status).toBe(400);
  const { error } = await res.json();
  expect(typeof error).toBe('string');
  expect(error).not.toMatch(/trim|Illegal arguments|intermediate value|is not a function/);
}

function realCaptcha() {
  const { token } = captchaApi.generate();
  for (let a = -9; a <= 18; a++) if (captchaApi.verify(token, String(a))) return { token, answer: String(a) };
  throw new Error('找不到答案');
}
const count = async (sql, args = []) => (await dbApi.pool.query(sql, args))[0][0].n;

describe('#20 非字符串字段 → 400', () => {
  it.each(NON_STRINGS)('POST /api/family name=%j', async (v) => {
    await loginAs(await makeUser());
    await expect400(await post(familyRoute, '/api/family', { name: v }));
  });
  it.each(NON_STRINGS)('POST /api/family/apply name=%j', async (v) => {
    await loginAs(await makeUser());
    await expect400(await post(applyRoute, '/api/family/apply', { name: v }));
  });
  it.each(NON_STRINGS)('POST /api/family/invite username=%j', async (v) => {
    const c = await makeUser();
    await makeFamily(c);
    await loginAs(c);
    await expect400(await post(inviteRoute, '/api/family/invite', { username: v }));
  });
  it.each(NON_STRINGS)('POST /api/feedback content=%j', async (v) => {
    await loginAs(await makeUser());
    await expect400(await post(feedbackRoute, '/api/feedback', { content: v }));
  });
  it.each(NON_STRINGS)('POST /api/auth/password currentPassword/newPassword=%j', async (v) => {
    const u = await makeUser({ password: 'oldpass123' });
    await loginAs(u);
    await expect400(await post(passwordRoute, '/api/auth/password', { currentPassword: v, newPassword: 'newpass123' }));
    await expect400(await post(passwordRoute, '/api/auth/password', { currentPassword: 'oldpass123', newPassword: v }));
  });
  it.each(NON_STRINGS)('POST /api/auth/login username/password=%j', async (v) => {
    logout();
    await expect400(await post(loginRoute, '/api/auth/login', { username: v, password: 'x' }));
    await expect400(await post(loginRoute, '/api/auth/login', { username: 'x', password: v }));
  });
  it.each(NON_STRINGS)('POST /api/auth/register username/password/familyName=%j', async (v) => {
    logout();
    const { token, answer } = realCaptcha();
    const base = { captchaToken: token, captchaAnswer: answer };
    await expect400(await post(registerRoute, '/api/auth/register', { ...base, username: v, password: 'pw123456' }));
    await expect400(await post(registerRoute, '/api/auth/register', { ...base, username: uniq('t'), password: v }));
    await expect400(await post(registerRoute, '/api/auth/register', { ...base, username: uniq('t'), password: 'pw123456', accountType: 'family', familyName: v }));
    // 校验在消耗验证码之前: 同一个 token 还能用
    expect((await post(registerRoute, '/api/auth/register', { ...base, username: uniq('t'), password: 'pw123456' })).status).toBe(200);
  });
  it('正例: 合法字符串照常通过(含首尾空格被裁掉)', async () => {
    await loginAs(await makeUser());
    const name = uniq('fam');
    const res = await post(familyRoute, '/api/family', { name: `  ${name}  ` });
    expect(res.status).toBe(200);
    expect((await res.json()).familyName).toBe(name);
  });
});

describe('#21 长度限制', () => {
  it('注册 username 101 字符 → 400；100 字符通过', async () => {
    logout();
    const { token, answer } = realCaptcha();
    await expect400(await post(registerRoute, '/api/auth/register', { username: 'a'.repeat(101), password: 'pw123456', captchaToken: token, captchaAnswer: answer }));
    expect((await post(registerRoute, '/api/auth/register', { username: 'b'.repeat(100), password: 'pw123456', captchaToken: token, captchaAnswer: answer })).status).toBe(200);
  });
  it('开放路径: 超长用户名不消耗验证码也不占 IP 名额', async () => {
    logout();
    const ip = `10.9.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}`;
    const { token, answer } = realCaptcha();
    const res = await post(registerRoute, '/api/auth/register', { username: 'a'.repeat(101), password: 'pw123456', captchaToken: token, captchaAnswer: answer }, { 'cf-connecting-ip': ip });
    expect(res.status).toBe(400);
    expect(await count('SELECT COUNT(*) n FROM signup_attempts WHERE ip = ?', [ip])).toBe(0);
    expect(await count('SELECT COUNT(*) n FROM captcha_used WHERE token_key = ?', [captchaApi.tokenKey(token)])).toBe(0);
  });
  it('邀请路径: 超长用户名 → 400，邀请码未被消耗', async () => {
    const inviter = await makeUser();
    const row = await dbApi.createInviteCode(inviter.id);
    logout();
    await expect400(await post(registerRoute, '/api/auth/register', { username: 'a'.repeat(101), password: 'pw123456', inviteCode: row.code }));
    expect(await count('SELECT COUNT(*) n FROM invite_codes WHERE code = ? AND used_by IS NULL', [row.code])).toBe(1);
    expect((await post(registerRoute, '/api/auth/register', { username: uniq('ok'), password: 'pw123456', inviteCode: row.code })).status).toBe(200);
  });
  it('POST /api/family name 101 字符 → 400，措辞与 PATCH 一致；100 字符通过', async () => {
    const u = await makeUser();
    await loginAs(u);
    const res = await post(familyRoute, '/api/family', { name: 'x'.repeat(101) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('家庭名称不能超过 100 个字符');
    expect((await post(familyRoute, '/api/family', { name: uniq('f').padEnd(100, 'y') })).status).toBe(200);
    const patch = await familyRoute.PATCH(req('/api/family', { method: 'PATCH', body: { name: 'x'.repeat(101) } }));
    expect((await patch.json()).error).toBe('家庭名称不能超过 100 个字符');
  });
  it('apply / invite 的名称超长 → 400', async () => {
    await loginAs(await makeUser());
    await expect400(await post(applyRoute, '/api/family/apply', { name: 'x'.repeat(101) }));
    const c = await makeUser();
    await makeFamily(c);
    await loginAs(c);
    await expect400(await post(inviteRoute, '/api/family/invite', { username: 'x'.repeat(101) }));
  });
  it('feedback 仍是 2000 字上限(2000 通过、2001 → 400)', async () => {
    await loginAs(await makeUser());
    expect((await post(feedbackRoute, '/api/feedback', { content: 'a'.repeat(2000) })).status).toBe(200);
    const res = await post(feedbackRoute, '/api/feedback', { content: 'a'.repeat(2001) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('2000');
  });
  it('长度按字符数算: 100 个 emoji 的家庭名通过，101 个 → 400', async () => {
    await loginAs(await makeUser());
    expect((await post(familyRoute, '/api/family', { name: '😀'.repeat(100) })).status).toBe(200);
    const u2 = await makeUser();
    await loginAs(u2);
    expect((await post(familyRoute, '/api/family', { name: '😀'.repeat(101) })).status).toBe(400);
  });
});

describe('#21 密码 72 字节上限', () => {
  it('注册: 73 字节 → 400 且不建号；72 字节通过', async () => {
    logout();
    const { token, answer } = realCaptcha();
    const name = uniq('pw');
    const res = await post(registerRoute, '/api/auth/register', { username: name, password: 'p'.repeat(73), captchaToken: token, captchaAnswer: answer });
    await expect400(res);
    expect(await count('SELECT COUNT(*) n FROM users WHERE username = ?', [name])).toBe(0);
    expect((await post(registerRoute, '/api/auth/register', { username: name, password: 'p'.repeat(72), captchaToken: token, captchaAnswer: answer })).status).toBe(200);
  });
  it('按字节不按字符: 25 个汉字(75 字节) → 400；24 个汉字(72 字节)通过', async () => {
    logout();
    const a = realCaptcha();
    await expect400(await post(registerRoute, '/api/auth/register', { username: uniq('pw'), password: '密'.repeat(25), captchaToken: a.token, captchaAnswer: a.answer }));
    expect((await post(registerRoute, '/api/auth/register', { username: uniq('pw'), password: '密'.repeat(24), captchaToken: a.token, captchaAnswer: a.answer })).status).toBe(200);
  });
  it('改密码: 新密码 73 字节 → 400 且密码没变；72 字节通过', async () => {
    const u = await makeUser({ password: 'oldpass123' });
    await loginAs(u);
    await expect400(await post(passwordRoute, '/api/auth/password', { currentPassword: 'oldpass123', newPassword: 'n'.repeat(73) }));
    const [[before]] = await dbApi.pool.query('SELECT password_hash h FROM users WHERE id = ?', [u.id]);
    expect(await bcrypt.compare('oldpass123', before.h)).toBe(true);
    expect((await post(passwordRoute, '/api/auth/password', { currentPassword: 'oldpass123', newPassword: 'n'.repeat(72) })).status).toBe(200);
  });
});

describe('#27 from/to 日期参数', () => {
  const user = [
    ['/api/stats/overview', overviewRoute], ['/api/stats/category', categoryRoute], ['/api/stats/monthly', monthlyRoute],
    ['/api/stats/subcategory', subcategoryRoute], ['/api/receipts', receiptsRoute],
  ];
  const admin = [
    ['/api/admin/stats/overview', adminOverviewRoute], ['/api/admin/stats/category', adminCategoryRoute], ['/api/admin/stats/monthly', adminMonthlyRoute],
    ['/api/admin/stats/subcategory', adminSubcategoryRoute], ['/api/admin/stats/by-user', adminByUserRoute], ['/api/admin/receipts', adminReceiptsRoute],
  ];
  const BAD = ['%F0%9F%98%80', '%E2%80%8B2026-01-01', '%EF%BB%BF2026-01-01', '2026-02-30', '2026-1-1', 'abc', '2026-01-01%20'];

  it.each(user)('%s: 非法 from/to → 400；合法或缺省 → 200', async (url, route) => {
    await loginAs(await makeUser());
    for (const bad of BAD) {
      await expect400(await route.GET(req(`${url}?from=${bad}`)));
      await expect400(await route.GET(req(`${url}?to=${bad}`)));
    }
    expect((await route.GET(req(`${url}?from=2026-01-01&to=2026-12-31`))).status).toBe(200);
    expect((await route.GET(req(`${url}?from=&to=`))).status).toBe(200);
    expect((await route.GET(req(url))).status).toBe(200);
  });
  it.each(admin)('%s: 非法 from/to → 400；合法或缺省 → 200', async (url, route) => {
    await loginAs(await makeUser({ admin: true }));
    for (const bad of BAD) {
      await expect400(await route.GET(req(`${url}?from=${bad}`)));
      await expect400(await route.GET(req(`${url}?to=${bad}`)));
    }
    expect((await route.GET(req(`${url}?from=2026-01-01&to=2026-12-31`))).status).toBe(200);
    expect((await route.GET(req(url))).status).toBe(200);
  });
});

describe('管理员路由的 userId / limit 参数', () => {
  const routes = [
    ['/api/admin/receipts', adminReceiptsRoute], ['/api/admin/stats/overview', adminOverviewRoute], ['/api/admin/stats/category', adminCategoryRoute],
    ['/api/admin/stats/monthly', adminMonthlyRoute], ['/api/admin/stats/subcategory', adminSubcategoryRoute],
  ];
  it.each(routes)('%s: 非数字/0/负数 userId → 400；数字或缺省 → 200', async (url, route) => {
    const u = await makeUser();
    await loginAs(await makeUser({ admin: true }));
    for (const bad of ['abc', '1abc', '0', '-1', '1.5']) await expect400(await route.GET(req(`${url}?userId=${bad}`)));
    expect((await route.GET(req(`${url}?userId=${u.id}`))).status).toBe(200);
    expect((await route.GET(req(`${url}?userId=`))).status).toBe(200);
  });
  it('/api/admin/audit?limit= 严格: 非正整数 → 400；正整数、缺省 → 200', async () => {
    await loginAs(await makeUser({ admin: true }));
    for (const bad of ['abc', '0', '-5', '1.5', '10x']) await expect400(await adminAuditRoute.GET(req(`/api/admin/audit?limit=${bad}`)));
    expect((await adminAuditRoute.GET(req('/api/admin/audit?limit=5'))).status).toBe(200);
    expect((await adminAuditRoute.GET(req('/api/admin/audit'))).status).toBe(200);
  });
});

describe('#29 登录对不存在的用户也跑一次 bcrypt', () => {
  it('用户不存在 → 仍调用 bcrypt.compare(哑哈希)，响应与密码错误相同', async () => {
    logout();
    const spy = vi.spyOn(bcrypt, 'compare');
    const res = await post(loginRoute, '/api/auth/login', { username: uniq('nobody'), password: 'whatever' });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('用户名或密码错误');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toMatch(/^\$2[aby]\$10\$/);
  });
  it('空用户名也一样', async () => {
    logout();
    const spy = vi.spyOn(bcrypt, 'compare');
    expect((await post(loginRoute, '/api/auth/login', { username: '', password: 'x' })).status).toBe(401);
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it('正例: 存在的用户密码对 → 200，密码错 → 401', async () => {
    const u = await makeUser({ password: 'rightpass1' });
    logout();
    expect((await post(loginRoute, '/api/auth/login', { username: u.username, password: 'wrongpass1' })).status).toBe(401);
    expect((await post(loginRoute, '/api/auth/login', { username: u.username, password: 'rightpass1' })).status).toBe(200);
  });
  it('哑哈希的明文不会让任何登录成功(没有用户时不会因哈希匹配而放行)', async () => {
    logout();
    vi.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    expect((await post(loginRoute, '/api/auth/login', { username: uniq('nobody'), password: 'x' })).status).toBe(401);
  });
});

describe('wrap(): 意料之外的异常不泄露内部报错', () => {
  it('非 HttpError → 500 + 通用提示，真实错误写服务端日志', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await wrap(async () => { throw new Error("Data too long for column 'name' at row 1"); })();
    expect(res.status).toBe(500);
    const { error } = await res.json();
    expect(error).toBe('服务器内部错误，请稍后重试');
    expect(error).not.toContain('Data too long');
    expect(log).toHaveBeenCalled();
    expect(String(log.mock.calls[0][0])).toContain('Data too long');
  });
  it('正例: 抛出的 HttpError 仍保留状态码和消息', async () => {
    const { HttpError } = await import('@/src/http');
    const res = await wrap(async () => { throw new HttpError(418, '我是茶壶'); })();
    expect(res.status).toBe(418);
    expect((await res.json()).error).toBe('我是茶壶');
  });
});
