// Q20/Q25: 同一用户名或同一 IP 15 分钟内失败 10 次即锁定；IP 取 CF-Connecting-IP
import { describe, it, expect } from 'vitest';
import * as loginRoute from '@/app/api/auth/login/route.js';
import dbApi from '@/src/db.cjs';
import { makeUser, req, uniq, logout } from './helpers.js';

const login = (username, password, ip) =>
  loginRoute.POST(req('/api/auth/login', {
    method: 'POST',
    body: { username, password },
    headers: ip ? { 'cf-connecting-ip': ip } : {},
  }));

const randIp = () => `10.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}`;

describe('登录防爆破', () => {
  it('正确密码 → 200', async () => {
    logout();
    const u = await makeUser({ password: 'right-pass' });
    expect((await login(u.username, 'right-pass', randIp())).status).toBe(200);
  });

  it('同一用户名失败 10 次后，即使密码正确也被锁 → 429', async () => {
    const u = await makeUser({ password: 'right-pass' });
    for (let i = 0; i < 10; i++) {
      // 每次换 IP，确认是"按用户名"锁的
      expect((await login(u.username, 'wrong', randIp())).status).toBe(401);
    }
    expect((await login(u.username, 'right-pass', randIp())).status).toBe(429);
  });

  it('失败 9 次仍可用正确密码登录，成功后该用户名的失败计数清零', async () => {
    const u = await makeUser({ password: 'right-pass' });
    for (let i = 0; i < 9; i++) await login(u.username, 'wrong', randIp());
    expect((await login(u.username, 'right-pass', randIp())).status).toBe(200);
    for (let i = 0; i < 9; i++) await login(u.username, 'wrong', randIp());
    expect((await login(u.username, 'right-pass', randIp())).status).toBe(200);
  });

  it('同一 IP 对不同用户名失败 10 次后，该 IP 被锁 → 429；其他 IP 不受影响', async () => {
    const ip = randIp();
    for (let i = 0; i < 10; i++) await login(uniq('nobody'), 'wrong', ip);
    const u = await makeUser({ password: 'right-pass' });
    expect((await login(u.username, 'right-pass', ip)).status).toBe(429);
    expect((await login(u.username, 'right-pass', randIp())).status).toBe(200);
  });

  it('超过 15 分钟的失败记录不计入', async () => {
    const u = await makeUser({ password: 'right-pass' });
    for (let i = 0; i < 10; i++) await login(u.username, 'wrong', randIp());
    await dbApi.pool.execute(
      'UPDATE login_failures SET created_at = NOW() - INTERVAL 16 MINUTE WHERE username = :u',
      { u: u.username }
    );
    expect((await login(u.username, 'right-pass', randIp())).status).toBe(200);
  });

  // 固定锁 15 分钟: 从凑满第 10 次失败那一刻起算，而不是"窗口里最早那次失败过期就解锁"
  async function seedFailures(username, minutesAgoList) {
    for (const m of minutesAgoList) {
      await dbApi.pool.execute(
        'INSERT INTO login_failures (username, ip, created_at) VALUES (:u, :ip, NOW() - INTERVAL :m MINUTE)',
        { u: username, ip: randIp(), m }
      );
    }
  }

  it('第 1 次失败在 16 分钟前、后 9 次在 2 分钟前: 凑满 10 次的时刻在 2 分钟前，仍在锁定中 → 429', async () => {
    const u = await makeUser({ password: 'right-pass' });
    await seedFailures(u.username, [16, 2, 2, 2, 2, 2, 2, 2, 2, 2]);
    expect((await login(u.username, 'right-pass', randIp())).status).toBe(429);
  });

  it('10 次失败跨度超过 15 分钟(从未在 15 分钟内凑满 10 次)→ 不锁 → 200', async () => {
    const u = await makeUser({ password: 'right-pass' });
    await seedFailures(u.username, [18, 2, 2, 2, 2, 2, 2, 2, 2, 2]);
    expect((await login(u.username, 'right-pass', randIp())).status).toBe(200);
  });

  it('并发爆破: 30 个错误密码同时到达，真正进入密码校验(401)的不超过 10 个', async () => {
    const u = await makeUser({ password: 'right-pass' });
    const results = await Promise.all(Array.from({ length: 30 }, () => login(u.username, 'wrong', randIp())));
    const statuses = results.map((r) => r.status);
    const burstGuesses = statuses.filter((s) => s === 401).length;
    expect(burstGuesses).toBeLessThanOrEqual(10);
    expect(statuses.filter((s) => s === 401 || s === 429).length).toBe(30);
    // 被拒的请求会撤回自己的记录，所以这一批之后可能还没锁；继续顺序猜，
    // 整个窗口里拿到"真正校验密码"机会(401)的总次数仍不能超过 10，第 11 次起一定是 429
    let laterGuesses = 0;
    for (let i = 0; i < 15; i++) {
      const st = (await login(u.username, 'wrong', randIp())).status;
      if (st === 401) laterGuesses++;
      else expect(st).toBe(429);
    }
    expect(burstGuesses + laterGuesses).toBe(10);
    expect((await login(u.username, 'right-pass', randIp())).status).toBe(429);
  });

  it('没有 CF-Connecting-IP 时退回 X-Forwarded-For: 同一 XFF 失败 10 次 → 该 IP 被锁', async () => {
    const ip = randIp();
    const xffLogin = (username, password) =>
      loginRoute.POST(req('/api/auth/login', { method: 'POST', body: { username, password }, headers: { 'x-forwarded-for': ip } }));
    for (let i = 0; i < 10; i++) await xffLogin(uniq('nobody'), 'wrong');
    const u = await makeUser({ password: 'right-pass' });
    expect((await xffLogin(u.username, 'right-pass')).status).toBe(429);
  });

  it('两个 IP 头都没有时不按 IP 锁(不把所有人归进同一个桶)，仍按用户名锁', async () => {
    const noIp = (username, password) => loginRoute.POST(req('/api/auth/login', { method: 'POST', body: { username, password } }));
    for (let i = 0; i < 10; i++) await noIp(uniq('nobody'), 'wrong');
    const u = await makeUser({ password: 'right-pass' });
    expect((await noIp(u.username, 'right-pass')).status).toBe(200);
    for (let i = 0; i < 10; i++) await noIp(u.username, 'wrong');
    expect((await noIp(u.username, 'right-pass')).status).toBe(429);
  });

  it('超长用户名(300 字符)按普通失败处理 → 401，不是 500', async () => {
    expect((await login('x'.repeat(300), 'wrong', randIp())).status).toBe(401);
  });

  it('登录请求体是 null → 400，不是 500', async () => {
    const res = await loginRoute.POST(req('/api/auth/login', { method: 'POST', body: 'null' }));
    expect(res.status).toBe(400);
  });

  it('登录请求体超过 16 KB → 413', async () => {
    expect((await login('a', 'x'.repeat(20 * 1024), randIp())).status).toBe(413);
  });
});
