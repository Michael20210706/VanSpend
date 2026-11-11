// 压测发现: 同一用户名并发登录时，login_failures 上的 DELETE 偶发 InnoDB 死锁(1213)，登录返回 500(issue #42)
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as loginRoute from '@/app/api/auth/login/route.js';
import dbApi from '@/src/db.cjs';
import { makeUser, req, uniq } from './helpers.js';

afterEach(() => vi.restoreAllMocks());

const login = (username, password, ip) =>
  loginRoute.POST(req('/api/auth/login', { method: 'POST', body: { username, password }, headers: { 'cf-connecting-ip': ip } }));
const randIp = () => `10.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}`;
const deadlock = () => Object.assign(new Error('Deadlock found when trying to get lock'), { code: 'ER_LOCK_DEADLOCK' });
const rowsFor = async (username) => (await dbApi.pool.query('SELECT COUNT(*) AS n FROM login_failures WHERE username = ?', [username]))[0][0].n;

describe('登录失败计数的写入遇到死锁会重试，而不是让登录返回 500', () => {
  it('并发登录风暴(同一用户名、正确与错误密码混合)不出现 5xx', async () => {
    const u = await makeUser({ password: 'right-pass' });
    for (let round = 0; round < 6; round++) {
      const calls = [];
      for (let i = 0; i < 24; i++) calls.push(login(u.username, i % 4 === 0 ? 'wrong' : 'right-pass', randIp()));
      const statuses = (await Promise.all(calls)).map((r) => r.status);
      expect(statuses.filter((s) => s >= 500), `round ${round}`).toEqual([]);
    }
  });

  it.each([
    ['clearLoginFailures', (name) => dbApi.clearLoginFailures(name)],
    ['deleteLoginAttempt', async () => {
      const id = await dbApi.recordLoginFailure(uniq('x'), '10.9.9.9');
      return dbApi.deleteLoginAttempt(id);
    }],
    ['recordLoginFailure', (name) => dbApi.recordLoginFailure(name, '10.9.9.9')],
  ])('%s: 注入一次死锁 → 自动重来并成功', async (_n, run) => {
    const real = dbApi.pool.execute.bind(dbApi.pool);
    let injected = 0;
    vi.spyOn(dbApi.pool, 'execute').mockImplementation(async (sql, params) => {
      if (/login_failures/.test(sql) && /^\s*DELETE/.test(sql) && injected++ < 1) throw deadlock();
      return real(sql, params);
    });
    await expect(run(uniq('dl'))).resolves.not.toThrow();
    expect(injected).toBeGreaterThan(1);
  });

  it('recordLoginFailure 重试不会重复插入: 清理旧记录的 DELETE 死锁一次后，该用户名仍只有 1 条记录', async () => {
    const name = uniq('dup');
    const real = dbApi.pool.execute.bind(dbApi.pool);
    let injected = 0;
    vi.spyOn(dbApi.pool, 'execute').mockImplementation(async (sql, params) => {
      if (/DELETE FROM login_failures WHERE created_at/.test(sql) && injected++ < 1) throw deadlock();
      return real(sql, params);
    });
    await dbApi.recordLoginFailure(name, '10.9.9.9');
    expect(injected).toBeGreaterThan(1);
    expect(await rowsFor(name)).toBe(1);
  });

  it('不是死锁的错误不被吞掉', async () => {
    vi.spyOn(dbApi.pool, 'execute').mockImplementation(async () => { throw Object.assign(new Error('boom'), { code: 'ER_X' }); });
    await expect(dbApi.clearLoginFailures('whoever')).rejects.toMatchObject({ code: 'ER_X' });
  });
});
