// issue #36: 前端按"数据库时间是 UTC"解析，所以连接必须显式是 UTC，不能碰巧依赖服务器默认时区
import { describe, it, expect } from 'vitest';
import dbApi from '@/src/db.cjs';
import { makeUser } from './helpers.js';
import { parseDbTime } from '@/lib/time.js';

describe('数据库连接时区', () => {
  it('每条连接的会话时区都显式是 +00:00', async () => {
    const conns = await Promise.all([1, 2, 3].map(() => dbApi.pool.getConnection()));
    try {
      for (const c of conns) {
        const [[r]] = await c.query('SELECT @@session.time_zone tz');
        expect(r.tz).toBe('+00:00');
      }
    } finally { conns.forEach((c) => c.release()); }
  });

  it('NOW() 写进 TIMESTAMP、读回的字符串按 UTC 解析，就是当前的真实时刻', async () => {
    const u = await makeUser();
    await dbApi.pool.query('UPDATE users SET family_joined_at = NOW() WHERE id = ?', [u.id]);
    const [[r]] = await dbApi.pool.query('SELECT family_joined_at j FROM users WHERE id = ?', [u.id]);
    expect(Math.abs(parseDbTime(r.j).getTime() - Date.now())).toBeLessThan(10_000);
  });

  it('Date 参数写入也是 UTC 瞬间(不受机器本地时区影响)', async () => {
    const u = await makeUser();
    const t = new Date('2026-03-01T12:34:56Z');
    await dbApi.pool.execute('UPDATE users SET family_joined_at = ? WHERE id = ?', [t, u.id]);
    const [[r]] = await dbApi.pool.query('SELECT family_joined_at j FROM users WHERE id = ?', [u.id]);
    expect(r.j).toBe('2026-03-01 12:34:56');
  });
});
