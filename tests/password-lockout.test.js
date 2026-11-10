// 已登录状态下的"输密码确认"接口(修改密码、注销账号)防爆破: 10 次 / 15 分钟，两个接口共用计数，只锁这个账号的这两个接口
import { describe, it, expect } from 'vitest';
import dbApi from '@/src/db.cjs';
import * as passwordRoute from '@/app/api/auth/password/route.js';
import * as deleteRoute from '@/app/api/auth/delete-account/route.js';
import * as loginRoute from '@/app/api/auth/login/route.js';
import { makeUser, loginAs, logout, req, uniq } from './helpers.js';

const changePw = (currentPassword, newPassword = 'brand-new-pass') =>
  passwordRoute.POST(req('/api/auth/password', { method: 'POST', body: { currentPassword, newPassword } }));
const del = (password) => deleteRoute.POST(req('/api/auth/delete-account', { method: 'POST', body: { password } }));
const rows = async (userId) => (await dbApi.pool.query('SELECT COUNT(*) n FROM login_failures WHERE username = ?', [`pw:${userId}`]))[0][0].n;
const login = (username, password) =>
  loginRoute.POST(req('/api/auth/login', { method: 'POST', body: { username, password }, headers: { 'cf-connecting-ip': `10.7.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}` } }));

describe('修改密码 / 注销账号的防爆破', () => {
  it('修改密码连错 10 次 → 第 11 次(即使密码正确)被锁 429；密码没改', async () => {
    const u = await makeUser({ password: 'right-pass-1' });
    await loginAs(u);
    for (let i = 0; i < 10; i++) expect((await changePw('wrong-' + i)).status).toBe(401);
    const locked = await changePw('right-pass-1');
    expect(locked.status).toBe(429);
    expect((await locked.json()).error).toContain('15 分钟');
    logout();
    expect((await login(u.username, 'right-pass-1')).status).toBe(200); // 密码还是原来的
  });

  it('两个接口共用计数: 修改密码错 5 次 + 注销错 5 次 → 两个接口都被锁，账号还在', async () => {
    const u = await makeUser({ password: 'right-pass-2' });
    await loginAs(u);
    for (let i = 0; i < 5; i++) expect((await changePw('wrong')).status).toBe(401);
    for (let i = 0; i < 5; i++) expect((await del('wrong')).status).toBe(401);
    expect((await changePw('right-pass-2')).status).toBe(429);
    expect((await del('right-pass-2')).status).toBe(429);
    expect((await dbApi.pool.query('SELECT 1 FROM users WHERE id = ?', [u.id]))[0]).toHaveLength(1);
  });

  it('注销账号连错 10 次 → 第 11 次被锁 429', async () => {
    const u = await makeUser({ password: 'right-pass-3' });
    await loginAs(u);
    for (let i = 0; i < 10; i++) expect((await del('wrong')).status).toBe(401);
    expect((await del('right-pass-3')).status).toBe(429);
  });

  it('错 9 次后用正确密码仍可以，成功后计数清零(再错 9 次仍不被锁)', async () => {
    const u = await makeUser({ password: 'right-pass-4' });
    await loginAs(u);
    for (let i = 0; i < 9; i++) await changePw('wrong');
    expect((await changePw('right-pass-4', 'right-pass-5')).status).toBe(200);
    expect(await rows(u.id)).toBe(0);
    for (let i = 0; i < 9; i++) expect((await changePw('wrong')).status).toBe(401);
    expect((await changePw('right-pass-5', 'right-pass-6')).status).toBe(200);
  });

  it('被锁时不再写记录；锁满 15 分钟后(记录过期)恢复', async () => {
    const u = await makeUser({ password: 'right-pass-7' });
    await loginAs(u);
    for (let i = 0; i < 10; i++) await changePw('wrong');
    for (let i = 0; i < 3; i++) expect((await changePw('right-pass-7')).status).toBe(429);
    expect(await rows(u.id)).toBe(10);
    await dbApi.pool.query("UPDATE login_failures SET created_at = NOW() - INTERVAL 20 MINUTE WHERE username = ?", [`pw:${u.id}`]);
    expect((await changePw('right-pass-7')).status).toBe(200);
  });

  it('只锁这个账号: 它自己登录不受影响，别的账号改密码不受影响', async () => {
    const a = await makeUser({ password: 'a-pass-1234' });
    const b = await makeUser({ password: 'b-pass-1234' });
    await loginAs(a);
    for (let i = 0; i < 10; i++) await changePw('wrong');
    expect((await changePw('a-pass-1234')).status).toBe(429);
    logout();
    expect((await login(a.username, 'a-pass-1234')).status).toBe(200);
    await loginAs(b);
    expect((await changePw('b-pass-1234', 'b-pass-5678')).status).toBe(200);
  });

  it('登录失败的计数不会拖累这两个接口，反过来也不会锁登录(键空间分开)', async () => {
    const u = await makeUser({ password: 'right-pass-8' });
    for (let i = 0; i < 9; i++) await login(u.username, 'wrong');
    await loginAs(u);
    for (let i = 0; i < 9; i++) expect((await changePw('wrong')).status).toBe(401);
    expect((await changePw('right-pass-8', 'right-pass-9')).status).toBe(200);
  });

  it('并发: 同一账号 20 个同时的错误尝试，进入 bcrypt 的不超过 10 个(先记后数)', async () => {
    const u = await makeUser({ password: 'right-pass-10' });
    await loginAs(u);
    const results = await Promise.all(Array.from({ length: 20 }, () => changePw('wrong-' + uniq('x'))));
    const s = results.map((r) => r.status);
    expect(s.filter((x) => x === 401).length).toBeLessThanOrEqual(10);
    expect(s.filter((x) => x === 401).length + s.filter((x) => x === 429).length).toBe(20);
    expect(await rows(u.id)).toBeLessThanOrEqual(10);
  });
});
