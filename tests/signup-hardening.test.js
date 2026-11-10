// 验证码只能用一次 + 开放注册按 IP 限速(此前: 验证码 5 分钟内可无限重放，也没有按 IP 的限速)
import { describe, it, expect } from 'vitest';
import dbApi from '@/src/db.cjs';
import captchaApi from '@/src/captcha.cjs';
import * as registerRoute from '@/app/api/auth/register/route.js';
import * as invitesRoute from '@/app/api/invites/route.js';
import { makeUser, loginAs, logout, req, uniq } from './helpers.js';

// 真验证码: 从 token 里读出答案(测试里才这样做；浏览器里答案只在图片像素里)
function realCaptcha() {
  const { token } = captchaApi.generate();
  const answer = Buffer.from(token.split('.')[0], 'base64url').toString().split(':')[0];
  return { token, answer };
}
const randIp = () => `10.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}`;
const reg = (extra = {}, ip) => {
  const { token, answer } = realCaptcha();
  return registerRoute.POST(req('/api/auth/register', {
    method: 'POST',
    body: { username: uniq('su'), password: 'pw123456', captchaToken: token, captchaAnswer: answer, ...extra },
    headers: ip ? { 'cf-connecting-ip': ip } : {},
  }));
};
const regWith = (token, answer, username, ip) =>
  registerRoute.POST(req('/api/auth/register', {
    method: 'POST', body: { username, password: 'pw123456', captchaToken: token, captchaAnswer: answer },
    headers: ip ? { 'cf-connecting-ip': ip } : {},
  }));
const userExists = async (username) => (await dbApi.pool.query('SELECT 1 FROM users WHERE username = ?', [username]))[0].length === 1;
const attempts = async (ip) => (await dbApi.pool.query('SELECT COUNT(*) n FROM signup_attempts WHERE ip = ?', [ip]))[0][0].n;

describe('验证码只能用一次', () => {
  it('第一次 → 200；用同一个 token 和正确答案再注册一个别的用户名 → 400，且没有建号', async () => {
    logout();
    const { token, answer } = realCaptcha();
    const a = uniq('su');
    const b = uniq('su');
    expect((await regWith(token, answer, a)).status).toBe(200);
    logout();
    const replay = await regWith(token, answer, b);
    expect(replay.status).toBe(400);
    expect((await replay.json()).error).toContain('验证码');
    expect(await userExists(a)).toBe(true);
    expect(await userExists(b)).toBe(false);
  });

  it('答案错也算用掉: 同一个 token 不能先猜错再猜对(一位数加减只有约 27 种答案)', async () => {
    logout();
    const { token, answer } = realCaptcha();
    const wrong = String(Number(answer) + 100);
    expect((await regWith(token, wrong, uniq('su'))).status).toBe(400);
    const u = uniq('su');
    expect((await regWith(token, answer, u)).status).toBe(400);
    expect(await userExists(u)).toBe(false);
  });

  it('用户名已被占用的失败也用掉验证码: 不能拿同一个 token 反复试探用户名', async () => {
    logout();
    const taken = await makeUser();
    const { token, answer } = realCaptcha();
    expect((await regWith(token, answer, taken.username)).status).toBe(400);
    const fresh = uniq('su');
    expect((await regWith(token, answer, fresh)).status).toBe(400); // token 已用掉
    expect(await userExists(fresh)).toBe(false);
  });

  it('并发用同一个 token 注册两个不同用户名 → 恰好一个成功', async () => {
    logout();
    const { token, answer } = realCaptcha();
    const names = [uniq('su'), uniq('su')];
    const results = await Promise.all(names.map((n) => regWith(token, answer, n)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    const created = (await Promise.all(names.map(userExists))).filter(Boolean);
    expect(created).toHaveLength(1);
  });

  it('每个新验证码各自有效；签名无效的垃圾 token → 400 且不写库', async () => {
    logout();
    expect((await reg()).status).toBe(200);
    logout();
    expect((await reg()).status).toBe(200);
    logout();
    const [[{ n: before }]] = await dbApi.pool.query('SELECT COUNT(*) n FROM captcha_used');
    expect((await regWith('garbage.token', '1', uniq('su'))).status).toBe(400);
    const [[{ n: after }]] = await dbApi.pool.query('SELECT COUNT(*) n FROM captcha_used');
    expect(after).toBe(before);
  });

  it('过期的已用记录在下一次写入时被清掉；邀请码注册不需要也不消耗验证码', async () => {
    await dbApi.pool.query("INSERT INTO captcha_used (token_key, created_at) VALUES (?, NOW() - INTERVAL 20 MINUTE)", ['f'.repeat(64)]);
    expect(await dbApi.consumeCaptcha('e'.repeat(64))).toBe(true);
    expect(await dbApi.consumeCaptcha('e'.repeat(64))).toBe(false);
    expect((await dbApi.pool.query('SELECT 1 FROM captcha_used WHERE token_key = ?', ['f'.repeat(64)]))[0]).toHaveLength(0);
    const inviter = await makeUser();
    await loginAs(inviter);
    const { code } = await (await invitesRoute.POST(req('/api/invites', { method: 'POST', body: {} }))).json();
    logout();
    const [[{ n: before }]] = await dbApi.pool.query('SELECT COUNT(*) n FROM captcha_used');
    const res = await registerRoute.POST(req('/api/auth/register', { method: 'POST', body: { username: uniq('inv'), password: 'pw123456', inviteCode: code } }));
    expect(res.status).toBe(200);
    const [[{ n: after }]] = await dbApi.pool.query('SELECT COUNT(*) n FROM captcha_used');
    expect(after).toBe(before);
  });
});

describe('开放注册按 IP 限速(滚动 24 小时 10 次)', () => {
  it('同一 IP 第 11 次 → 429 且没建号；其他 IP 不受影响；被拒的那次不占名额', async () => {
    logout();
    const ip = randIp();
    await dbApi.pool.query(`INSERT INTO signup_attempts (ip) VALUES ${Array(10).fill('(?)').join(',')}`, Array(10).fill(ip));
    const u = uniq('su');
    const { token, answer } = realCaptcha();
    const res = await regWith(token, answer, u, ip);
    expect(res.status).toBe(429);
    expect(await userExists(u)).toBe(false);
    expect(await attempts(ip)).toBe(10); // 撤销了自己那一笔
    expect((await reg({}, randIp())).status).toBe(200);
  });

  it('9 次之后第 10 次仍可以(上限是 10)', async () => {
    logout();
    const ip = randIp();
    await dbApi.pool.query(`INSERT INTO signup_attempts (ip) VALUES ${Array(9).fill('(?)').join(',')}`, Array(9).fill(ip));
    expect((await reg({}, ip)).status).toBe(200);
    logout();
    expect((await reg({}, ip)).status).toBe(429);
  });

  it('超过 24 小时的记录不算', async () => {
    logout();
    const ip = randIp();
    await dbApi.pool.query(`INSERT INTO signup_attempts (ip, created_at) VALUES ${Array(10).fill('(?, NOW() - INTERVAL 25 HOUR)').join(',')}`, Array(10).fill(ip));
    expect((await reg({}, ip)).status).toBe(200);
  });

  it('失败的尝试(用户名被占用)也占名额，不能靠换用户名无限试探', async () => {
    logout();
    const ip = randIp();
    const taken = await makeUser();
    await reg({ username: taken.username }, ip);
    expect(await attempts(ip)).toBe(1);
  });

  it('验证码没过(答案错/垃圾 token)的请求不占 IP 名额', async () => {
    logout();
    const ip = randIp();
    const { token } = realCaptcha();
    await regWith(token, '999', uniq('su'), ip);
    await regWith('garbage', '1', uniq('su'), ip);
    expect(await attempts(ip)).toBe(0);
  });

  it('邀请码注册不受 IP 限速影响', async () => {
    const ip = randIp();
    await dbApi.pool.query(`INSERT INTO signup_attempts (ip) VALUES ${Array(10).fill('(?)').join(',')}`, Array(10).fill(ip));
    const inviter = await makeUser();
    await loginAs(inviter);
    const { code } = await (await invitesRoute.POST(req('/api/invites', { method: 'POST', body: {} }))).json();
    logout();
    const res = await registerRoute.POST(req('/api/auth/register', {
      method: 'POST', body: { username: uniq('inv'), password: 'pw123456', inviteCode: code }, headers: { 'cf-connecting-ip': ip },
    }));
    expect(res.status).toBe(200);
  });

  it('取不到 IP(没有 CF-Connecting-IP / X-Forwarded-For)时不限速，不把所有人归进同一个桶', async () => {
    logout();
    const [[{ n: before }]] = await dbApi.pool.query('SELECT COUNT(*) n FROM signup_attempts');
    expect((await reg()).status).toBe(200);
    const [[{ n: after }]] = await dbApi.pool.query('SELECT COUNT(*) n FROM signup_attempts');
    expect(after).toBe(before);
  });

  it('并发: 同一 IP 15 个同时的尝试，放行的绝不超过 10 个(先记后数，宁可多拒也不多放，和扫描额度同一个取舍)', async () => {
    logout();
    const ip = randIp();
    const results = await Promise.all(Array.from({ length: 15 }, () => reg({}, ip)));
    const statuses = results.map((r) => r.status);
    const ok = statuses.filter((s) => s === 200).length;
    expect(ok).toBeGreaterThan(0);
    expect(ok).toBeLessThanOrEqual(10);
    expect(statuses.filter((s) => s === 429)).toHaveLength(15 - ok);
    expect(await attempts(ip)).toBe(ok); // 被拒的都撤销了自己那一笔
  });
});
