// seedAdmin: 从 .env 的 ADMIN_USERNAME / ADMIN_PASSWORD 初始化管理员。bcrypt 只取前 72 字节，
// 超长密码会让"前 72 字节相同的任何密码"都能登录，所以和示例密码一样直接拒绝。
import { describe, it, expect, vi, afterEach } from 'vitest';
import bcrypt from 'bcryptjs';
import dbApi from '@/src/db.cjs';
import { uniq } from './helpers.js';

const saved = { u: process.env.ADMIN_USERNAME, p: process.env.ADMIN_PASSWORD };
afterEach(() => {
  process.env.ADMIN_USERNAME = saved.u;
  process.env.ADMIN_PASSWORD = saved.p;
  vi.restoreAllMocks();
});

async function seedWith(password) {
  const username = uniq('seed');
  process.env.ADMIN_USERNAME = username;
  process.env.ADMIN_PASSWORD = password;
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  await dbApi.seedAdmin();
  return { user: await dbApi.findUserByUsername(username), warns: warn.mock.calls.map((c) => c.join(' ')) };
}

describe('seedAdmin 的密码长度', () => {
  it('恰好 72 字节: 创建管理员，密码可用', async () => {
    const pw = 'a'.repeat(72);
    const { user } = await seedWith(pw);
    expect(user).toBeTruthy();
    expect(user.is_admin).toBe(1);
    expect(await bcrypt.compare(pw, user.password_hash)).toBe(true);
  });

  it('73 字节: 不创建，告警里不含密码', async () => {
    const pw = 'b'.repeat(73);
    const { user, warns } = await seedWith(pw);
    expect(user).toBeFalsy();
    expect(warns.some((w) => w.includes('72'))).toBe(true);
    expect(warns.some((w) => w.includes(pw))).toBe(false);
  });

  it('按 UTF-8 字节而不是字符计: 25 个汉字(75 字节)也拒绝', async () => {
    const { user } = await seedWith('密'.repeat(25));
    expect(user).toBeFalsy();
  });
});
