// P1 / Q8、Q16、Q26: 每用户每天(滚动 24 小时)扫描额度，开放注册档 3 次，邀请/老账号档 20 次，管理员不限；
// 每次调用 OpenRouter 都记入 scan_log(失败也算)；超额返回 429
import { describe, it, expect, vi, afterEach } from 'vitest';
import dbApi from '@/src/db.cjs';
import openrouterLib from '@/src/openrouter.cjs';
import * as scanRoute from '@/app/api/scan/route.js';
import { makeUser, loginAs, logout, req } from './helpers.js';

const IMG = 'data:image/jpeg;base64,/9j/' + 'A'.repeat(396);
const scan = (image = IMG) => scanRoute.POST(req('/api/scan', { method: 'POST', body: { image } }));
const LIMIT = openrouterLib.config.scanQuota;
const logRows = async (userId) => (await dbApi.pool.query('SELECT * FROM scan_log WHERE user_id = ? ORDER BY id', [userId]))[0];

afterEach(() => vi.restoreAllMocks());
const mockScan = () => vi.spyOn(openrouterLib, 'scanReceipt').mockResolvedValue({ receipt: {}, items: [], raw: {} });

describe('额度配置', () => {
  it('config.json 里 open=3、normal=20', () => {
    expect(LIMIT).toEqual({ open: 3, normal: 20 });
  });
});

describe('扫描额度', () => {
  it('开放注册档: 前 3 次 200，第 4 次 429 且不再调用 OpenRouter', async () => {
    const spy = mockScan();
    const u = await makeUser({ tier: 'open' });
    await loginAs(u);
    for (let i = 0; i < LIMIT.open; i++) expect((await scan()).status).toBe(200);
    const res = await scan();
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/次/);
    expect(spy).toHaveBeenCalledTimes(LIMIT.open);
  });

  it('normal 档: 20 次内 200，第 21 次 429', async () => {
    const spy = mockScan();
    await loginAs(await makeUser());
    for (let i = 0; i < LIMIT.normal; i++) expect((await scan()).status).toBe(200);
    expect((await scan()).status).toBe(429);
    expect(spy).toHaveBeenCalledTimes(LIMIT.normal);
  });

  it('管理员不限额(超过 normal 上限仍 200)，但调用照样记录', async () => {
    mockScan();
    const admin = await makeUser({ admin: true, tier: 'open' });
    await loginAs(admin);
    for (let i = 0; i < LIMIT.normal + 3; i++) expect((await scan()).status).toBe(200);
    expect(await logRows(admin.id)).toHaveLength(LIMIT.normal + 3);
  });

  it('额度按用户独立: A 用完不影响 B', async () => {
    mockScan();
    const a = await makeUser({ tier: 'open' });
    const b = await makeUser({ tier: 'open' });
    await loginAs(a);
    for (let i = 0; i < LIMIT.open; i++) await scan();
    expect((await scan()).status).toBe(429);
    await loginAs(b);
    expect((await scan()).status).toBe(200);
  });

  // 用 SQL 的 NOW() - INTERVAL 造数据，不能用 JS Date: mysql2 会按本机时区序列化，而 MySQL 容器通常是 UTC，会差出几小时
  const seedScans = async (userId, hoursAgo, n) => {
    for (let i = 0; i < n; i++) {
      await dbApi.pool.execute(
        `INSERT INTO scan_log (user_id, model, success, created_at) VALUES (?, 'm', 1, NOW() - INTERVAL ${hoursAgo} HOUR)`, [userId]);
    }
  };

  it('滚动 24 小时: 25 小时前的记录不计入', async () => {
    mockScan();
    const u = await makeUser({ tier: 'open' });
    await seedScans(u.id, 25, LIMIT.open);
    await loginAs(u);
    for (let i = 0; i < LIMIT.open; i++) expect((await scan()).status).toBe(200);
    expect((await scan()).status).toBe(429);
  });

  it('滚动 24 小时: 23 小时前的记录仍然计入', async () => {
    mockScan();
    const v = await makeUser({ tier: 'open' });
    await seedScans(v.id, 23, LIMIT.open);
    await loginAs(v);
    expect((await scan()).status).toBe(429);
  });

  it('管理员把用户升到 normal 档后，额度立即变 20(无需重新登录)', async () => {
    mockScan();
    const u = await makeUser({ tier: 'open' });
    await loginAs(u);
    for (let i = 0; i < LIMIT.open; i++) await scan();
    expect((await scan()).status).toBe(429);
    await dbApi.pool.execute("UPDATE users SET scan_tier = 'normal' WHERE id = ?", [u.id]);
    expect((await scan()).status).toBe(200);
  });
});

describe('scan_log', () => {
  it('成功的调用记 success=1，并记录模型', async () => {
    mockScan();
    const u = await makeUser();
    await loginAs(u);
    await scan();
    const [row] = await logRows(u.id);
    expect(row.success).toBe(1);
    expect(row.model).toBe(openrouterLib.config.model);
  });

  it('失败的调用(OpenRouter 报错)记 success=0，仍然计入额度', async () => {
    vi.spyOn(openrouterLib, 'scanReceipt').mockRejectedValue(new Error('OpenRouter 请求失败 500'));
    const u = await makeUser({ tier: 'open' });
    await loginAs(u);
    for (let i = 0; i < LIMIT.open; i++) expect((await scan()).status).toBe(502);
    const rows = await logRows(u.id);
    expect(rows).toHaveLength(LIMIT.open);
    expect(rows.every((r) => r.success === 0)).toBe(true);
    expect((await scan()).status).toBe(429);
  });

  it('记录失败结果本身出错，仍返回 500(且不泄露内部报错)', async () => {
    vi.spyOn(openrouterLib, 'scanReceipt').mockRejectedValue(new Error('OpenRouter 请求失败 502'));
    vi.spyOn(dbApi, 'finishScan').mockRejectedValue(new Error('db gone'));
    const u = await makeUser();
    await loginAs(u);
    const res = await scan();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('识别服务暂时不可用，请稍后重试');
  });

  it('超额被拒的请求不留 scan_log 记录', async () => {
    mockScan();
    const u = await makeUser({ tier: 'open' });
    await loginAs(u);
    for (let i = 0; i < LIMIT.open + 4; i++) await scan();
    expect(await logRows(u.id)).toHaveLength(LIMIT.open);
  });

  it('非法/超大图在扣额度之前就被拒，不记录、不扣额度', async () => {
    const spy = mockScan();
    const u = await makeUser({ tier: 'open' });
    await loginAs(u);
    expect((await scan(['x'])).status).toBe(400);
    expect((await scan('data:image/jpeg;base64,' + 'A'.repeat(14 * 1024 * 1024))).status).toBe(413);
    expect(await logRows(u.id)).toHaveLength(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it('未登录 → 401，不记录', async () => {
    const spy = mockScan();
    logout();
    expect((await scan()).status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it('并发: open 档用户同时发 12 个扫描，真正调用 OpenRouter 的恰好 3 个，其余 429', async () => {
    const spy = mockScan();
    const u = await makeUser({ tier: 'open' });
    await loginAs(u);
    const results = await Promise.all(Array.from({ length: 12 }, () => scan()));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(LIMIT.open);
    expect(spy.mock.calls.length).toBeLessThanOrEqual(LIMIT.open);
    expect(statuses.filter((s) => s === 200 || s === 429)).toHaveLength(12);
    // 顺序再试，直到总数恰好 3 次放行
    let ok = statuses.filter((s) => s === 200).length;
    for (let i = 0; i < 6; i++) if ((await scan()).status === 200) ok++;
    expect(ok).toBe(LIMIT.open);
    expect(spy).toHaveBeenCalledTimes(LIMIT.open);
  });

  it('账号被删除后 scan_log 随之清除(外键级联)', async () => {
    mockScan();
    const u = await makeUser();
    await loginAs(u);
    await scan();
    await dbApi.deleteUser(u.id);
    expect(await logRows(u.id)).toHaveLength(0);
  });
});
