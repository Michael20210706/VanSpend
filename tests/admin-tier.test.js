// P1 / Q16、Q27: 管理员能看到每个用户的注册来源与额度档位，并能调整档位
import { describe, it, expect } from 'vitest';
import dbApi from '@/src/db.cjs';
import * as usersRoute from '@/app/api/admin/users/route.js';
import * as userIdRoute from '@/app/api/admin/users/[id]/route.js';
import { makeUser, loginAs, logout, req, ctx, uniq } from './helpers.js';

const patch = (id, body) => userIdRoute.PATCH(req('/x', { method: 'PATCH', body }), ctx({ id: String(id) }));
const tierOf = async (id) => (await dbApi.pool.query('SELECT scan_tier FROM users WHERE id = ?', [id]))[0][0].scan_tier;

describe('管理员调整额度档位', () => {
  it('管理员把 open 升到 normal → 200，库里已更新', async () => {
    const target = await makeUser({ tier: 'open' });
    await loginAs(await makeUser({ admin: true }));
    const res = await patch(target.id, { tier: 'normal' });
    expect(res.status).toBe(200);
    expect(await tierOf(target.id)).toBe('normal');
  });

  it('也能降回 open', async () => {
    const target = await makeUser();
    await loginAs(await makeUser({ admin: true }));
    expect((await patch(target.id, { tier: 'open' })).status).toBe(200);
    expect(await tierOf(target.id)).toBe('open');
  });

  it('普通用户 → 403，档位不变', async () => {
    const target = await makeUser({ tier: 'open' });
    await loginAs(await makeUser());
    expect((await patch(target.id, { tier: 'normal' })).status).toBe(403);
    expect(await tierOf(target.id)).toBe('open');
  });

  it('用户给自己升档 → 403', async () => {
    const self = await makeUser({ tier: 'open' });
    await loginAs(self);
    expect((await patch(self.id, { tier: 'normal' })).status).toBe(403);
    expect(await tierOf(self.id)).toBe('open');
  });

  it('未登录 → 401', async () => {
    logout();
    expect((await patch(1, { tier: 'normal' })).status).toBe(401);
  });

  it('id 不是纯数字(abc / 1abc / 0 / -1)→ 400，不是 500', async () => {
    await loginAs(await makeUser({ admin: true }));
    for (const id of ['abc', '1abc', '0', '-1', '1.5']) {
      expect((await patch(id, { tier: 'normal' })).status).toBe(400);
      expect((await userIdRoute.DELETE(req('/x', { method: 'DELETE' }), ctx({ id }))).status).toBe(400);
    }
  });

  it('非法档位 / 缺字段 → 400；不存在的用户 → 404', async () => {
    const target = await makeUser();
    await loginAs(await makeUser({ admin: true }));
    expect((await patch(target.id, { tier: 'vip' })).status).toBe(400);
    expect((await patch(target.id, {})).status).toBe(400);
    expect((await patch(99999999, { tier: 'normal' })).status).toBe(404);
  });
});

describe('降级到 open 档会作废该用户未使用的邀请码', () => {
  const codeStatus = async (id) => (await dbApi.pool.query(
    `SELECT CASE WHEN used_by IS NOT NULL OR used_at IS NOT NULL THEN 'used' WHEN revoked_at IS NOT NULL THEN 'revoked' ELSE 'unused' END AS s FROM invite_codes WHERE id = ?`, [id]))[0][0].s;
  const mint = async (userId, n) => {
    const ids = [];
    for (let i = 0; i < n; i++) {
      const [info] = await dbApi.pool.execute(
        'INSERT INTO invite_codes (code, created_by, expires_at) VALUES (?, ?, NOW() + INTERVAL 7 DAY)', [uniq('code') + 'xxxxxxxxxxxx', userId]);
      ids.push(info.insertId);
    }
    return ids;
  };

  it('降级后: 未使用的码全部作废，已被使用的码不受影响，别人的码不受影响', async () => {
    const target = await makeUser();
    const bystander = await makeUser();
    const invitee = await makeUser();
    const [u1, u2, used] = await mint(target.id, 3);
    await dbApi.pool.execute('UPDATE invite_codes SET used_by = ?, used_at = NOW() WHERE id = ?', [invitee.id, used]);
    const [other] = await mint(bystander.id, 1);
    await loginAs(await makeUser({ admin: true }));
    expect((await patch(target.id, { tier: 'open' })).status).toBe(200);
    expect(await codeStatus(u1)).toBe('revoked');
    expect(await codeStatus(u2)).toBe('revoked');
    expect(await codeStatus(used)).toBe('used');
    expect(await codeStatus(other)).toBe('unused');
  });

  it('作废后的码不能再用来注册', async () => {
    const target = await makeUser();
    const [id] = await mint(target.id, 1);
    const [[{ code }]] = await dbApi.pool.query('SELECT code FROM invite_codes WHERE id = ?', [id]);
    expect(await dbApi.peekInviteCode(code)).not.toBeNull();
    await loginAs(await makeUser({ admin: true }));
    await patch(target.id, { tier: 'open' });
    expect(await dbApi.peekInviteCode(code)).toBeNull();
  });

  it('升到 normal 不会"复活"已作废的码', async () => {
    const target = await makeUser();
    const [id] = await mint(target.id, 1);
    await loginAs(await makeUser({ admin: true }));
    await patch(target.id, { tier: 'open' });
    await patch(target.id, { tier: 'normal' });
    expect(await codeStatus(id)).toBe('revoked');
  });

  it('档位本来就是 open 时再设 open 也是安全的(幂等)', async () => {
    const target = await makeUser({ tier: 'open' });
    await loginAs(await makeUser({ admin: true }));
    expect((await patch(target.id, { tier: 'open' })).status).toBe(200);
  });
});

describe('管理员用户列表', () => {
  it('包含注册来源、额度档位、邀请人用户名', async () => {
    const inviter = await makeUser();
    const invitee = await makeUser({ tier: 'open' });
    await dbApi.pool.execute("UPDATE users SET signup_source = 'invite', invited_by = ? WHERE id = ?", [inviter.id, invitee.id]);
    const opener = await makeUser({ tier: 'open' });
    await dbApi.pool.execute("UPDATE users SET signup_source = 'open' WHERE id = ?", [opener.id]);
    await loginAs(await makeUser({ admin: true }));
    const rows = await (await usersRoute.GET(req('/api/admin/users'))).json();
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[invitee.id]).toMatchObject({ signup_source: 'invite', scan_tier: 'open', inviter_username: inviter.username });
    expect(byId[opener.id]).toMatchObject({ signup_source: 'open', scan_tier: 'open', inviter_username: null });
  });

  it('邀请人账号被删后，被邀请人的 invited_by 置空而不是连带删除', async () => {
    const inviter = await makeUser();
    const invitee = await makeUser();
    await dbApi.pool.execute('UPDATE users SET invited_by = ? WHERE id = ?', [inviter.id, invitee.id]);
    await dbApi.deleteUser(inviter.id);
    const [[row]] = await dbApi.pool.query('SELECT id, invited_by FROM users WHERE id = ?', [invitee.id]);
    expect(row.id).toBe(invitee.id);
    expect(row.invited_by).toBeNull();
  });
});
