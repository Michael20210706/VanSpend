// P1 / Q14-Q15: 正常档账号(和管理员)都能生成邀请码，开放注册档的账号不能(防止滚雪球)；家庭创建者可生成"入家庭邀请码"；
// 单次有效、7 天过期、每人 7 天最多 20 个；本人可作废
import { describe, it, expect, vi } from 'vitest';
import dbApi from '@/src/db.cjs';
import captchaApi from '@/src/captcha.cjs';
import * as registerRoute from '@/app/api/auth/register/route.js';
import * as invitesRoute from '@/app/api/invites/route.js';
import * as inviteIdRoute from '@/app/api/invites/[id]/route.js';
import { makeUser, makeFamily, loginAs, logout, req, ctx, uniq } from './helpers.js';

const create = (body = {}) => invitesRoute.POST(req('/api/invites', { method: 'POST', body }));
const list = (kind) => invitesRoute.GET(req('/api/invites' + (kind ? `?kind=${kind}` : '')));
const revoke = (id) => inviteIdRoute.DELETE(req('/x', { method: 'DELETE' }), ctx({ id: String(id) }));

describe('邀请码: 生成与查看', () => {
  it('未登录 → 401', async () => {
    logout();
    expect((await create()).status).toBe(401);
    expect((await list()).status).toBe(401);
  });

  it('普通用户生成 → 200，返回随机码，7 天后过期，且不绑定家庭', async () => {
    const u = await makeUser();
    await loginAs(u);
    const res = await create();
    expect(res.status).toBe(200);
    const c = await res.json();
    expect(c.code).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(c.family_id).toBeNull();
    const [[row]] = await dbApi.pool.query(
      'SELECT TIMESTAMPDIFF(HOUR, NOW(), expires_at) AS hrs, created_by FROM invite_codes WHERE id = ?', [c.id]);
    expect(row.created_by).toBe(u.id);
    expect(row.hrs).toBeGreaterThanOrEqual(167);
    expect(row.hrs).toBeLessThanOrEqual(168);
  });

  it('每次生成的码都不同', async () => {
    await loginAs(await makeUser());
    const a = await (await create()).json();
    const b = await (await create()).json();
    expect(a.code).not.toBe(b.code);
  });

  it('只能看到自己的码', async () => {
    const a = await makeUser();
    const b = await makeUser();
    await loginAs(a);
    const ac = await (await create()).json();
    await loginAs(b);
    const bc = await (await create()).json();
    const bList = await (await list()).json();
    expect(bList.map((c) => c.id)).toEqual([bc.id]);
    expect(bList.map((c) => c.id)).not.toContain(ac.id);
  });

  it('列表带状态: 未使用 / 已使用(含使用者用户名) / 已作废 / 已过期', async () => {
    const creator = await makeUser();
    const invitee = await makeUser();
    await loginAs(creator);
    const fresh = await (await create()).json();
    const used = await (await create()).json();
    const revoked = await (await create()).json();
    const expired = await (await create()).json();
    await dbApi.pool.execute('UPDATE invite_codes SET used_by = ?, used_at = NOW() WHERE id = ?', [invitee.id, used.id]);
    await dbApi.pool.execute('UPDATE invite_codes SET revoked_at = NOW() WHERE id = ?', [revoked.id]);
    await dbApi.pool.execute('UPDATE invite_codes SET expires_at = NOW() - INTERVAL 1 HOUR WHERE id = ?', [expired.id]);
    const byId = Object.fromEntries((await (await list()).json()).map((c) => [c.id, c]));
    expect(byId[fresh.id].status).toBe('unused');
    expect(byId[used.id].status).toBe('used');
    expect(byId[used.id].used_by_username).toBe(invitee.username);
    expect(byId[revoked.id].status).toBe('revoked');
    expect(byId[expired.id].status).toBe('expired');
  });

  it('7 天内最多生成 20 个码，第 21 个 → 400；作废不会腾出名额', async () => {
    await loginAs(await makeUser());
    const ids = [];
    for (let i = 0; i < 20; i++) {
      const res = await create();
      expect(res.status).toBe(200);
      ids.push((await res.json()).id);
    }
    expect((await create()).status).toBe(400);
    expect((await revoke(ids[0])).status).toBe(200);
    expect((await create()).status).toBe(400);
  });

  it('已被使用的码也计入 7 天上限(用掉一个不会腾出名额，防止滚雪球)', async () => {
    const creator = await makeUser();
    await loginAs(creator);
    const ids = [];
    for (let i = 0; i < 20; i++) ids.push((await (await create()).json()).id);
    const invitee = await makeUser();
    await dbApi.pool.execute('UPDATE invite_codes SET used_by = ?, used_at = NOW() WHERE id = ?', [invitee.id, ids[0]]);
    expect((await create()).status).toBe(400);
  });

  it('8 天前生成的码不计入上限', async () => {
    const u = await makeUser();
    await loginAs(u);
    for (let i = 0; i < 20; i++) await create();
    await dbApi.pool.execute('UPDATE invite_codes SET created_at = NOW() - INTERVAL 8 DAY WHERE created_by = ? LIMIT 5', [u.id]);
    for (let i = 0; i < 5; i++) expect((await create()).status).toBe(200);
    expect((await create()).status).toBe(400);
  });

  it('上限按用户独立: A 用满不影响 B', async () => {
    await loginAs(await makeUser());
    for (let i = 0; i < 20; i++) await create();
    expect((await create()).status).toBe(400);
    await loginAs(await makeUser());
    expect((await create()).status).toBe(200);
  });

  it('并发: 同一用户同时生成 30 个，恰好成功 20 个', async () => {
    await loginAs(await makeUser());
    const statuses = (await Promise.all(Array.from({ length: 30 }, () => create()))).map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(20);
    expect(statuses.filter((s) => s === 400)).toHaveLength(10);
  });
});

describe('邀请码: 开放注册档账号不能发码(防止过一次验证码就无限滚出免验证码账号)', () => {
  it('open 档的普通用户生成普通码 → 403，且没有生成任何码', async () => {
    const u = await makeUser({ tier: 'open' });
    await loginAs(u);
    expect((await create()).status).toBe(403);
    const [[{ n }]] = await dbApi.pool.query('SELECT COUNT(*) AS n FROM invite_codes WHERE created_by = ?', [u.id]);
    expect(n).toBe(0);
  });

  it('open 档的家庭创建者生成家庭码 → 也是 403(开放注册时顺手建个家庭不能绕过)', async () => {
    const u = await makeUser({ tier: 'open' });
    await makeFamily(u);
    await loginAs(u);
    expect((await create({ family: true })).status).toBe(403);
  });

  it('管理员即使档位是 open 也能发码', async () => {
    await loginAs(await makeUser({ admin: true, tier: 'open' }));
    expect((await create()).status).toBe(200);
  });

  it('被管理员升到 normal 后立即能发码(无需重新登录)；降回 open 后立即不能', async () => {
    const u = await makeUser({ tier: 'open' });
    await loginAs(u);
    expect((await create()).status).toBe(403);
    await dbApi.pool.execute("UPDATE users SET scan_tier = 'normal' WHERE id = ?", [u.id]);
    expect((await create()).status).toBe(200);
    await dbApi.pool.execute("UPDATE users SET scan_tier = 'open' WHERE id = ?", [u.id]);
    expect((await create()).status).toBe(403);
  });

  it('open 档用户仍能查看(列出)自己已有的码', async () => {
    const u = await makeUser();
    await loginAs(u);
    await create();
    await dbApi.pool.execute("UPDATE users SET scan_tier = 'open' WHERE id = ?", [u.id]);
    expect((await list()).status).toBe(200);
  });

  it('开放注册进来的账号走完整链路: 注册(open 档) → 想发码被拒', async () => {
    const spy = vi.spyOn(captchaApi, 'verify').mockReturnValue(true);
    logout();
    const res = await registerRoute.POST(req('/api/auth/register', { method: 'POST', body: { username: uniq('open'), password: 'pw123456', captchaToken: 't', captchaAnswer: '1' } }));
    spy.mockRestore();
    expect(res.status).toBe(200);
    expect((await create()).status).toBe(403); // 注册成功后 cookie 里就是这个新账号
  });
});

describe('邀请码: 家庭码', () => {
  it('家庭创建者生成家庭码 → 绑定自己的家庭', async () => {
    const creator = await makeUser();
    const familyId = await makeFamily(creator);
    await loginAs(creator);
    const res = await create({ family: true });
    expect(res.status).toBe(200);
    expect((await res.json()).family_id).toBe(familyId);
  });

  it('家庭普通成员生成家庭码 → 403', async () => {
    const creator = await makeUser();
    const member = await makeUser();
    await makeFamily(creator, member);
    await loginAs(member);
    expect((await create({ family: true })).status).toBe(403);
  });

  it('不在任何家庭的用户生成家庭码 → 403', async () => {
    await loginAs(await makeUser());
    expect((await create({ family: true })).status).toBe(403);
  });

  it('家庭成员仍可生成普通码(不绑定家庭)', async () => {
    const creator = await makeUser();
    const member = await makeUser();
    await makeFamily(creator, member);
    await loginAs(member);
    const res = await create();
    expect(res.status).toBe(200);
    expect((await res.json()).family_id).toBeNull();
  });

  it('?kind=family 只列家庭码，?kind=personal 只列普通码', async () => {
    const creator = await makeUser();
    await makeFamily(creator);
    await loginAs(creator);
    const p = await (await create()).json();
    const f = await (await create({ family: true })).json();
    expect((await (await list('family')).json()).map((c) => c.id)).toEqual([f.id]);
    expect((await (await list('personal')).json()).map((c) => c.id)).toEqual([p.id]);
    expect((await (await list()).json()).map((c) => c.id).sort()).toEqual([p.id, f.id].sort());
  });

  it('请求体里 family 不是布尔值(如字符串 "false")按普通码处理，不当成家庭码', async () => {
    const creator = await makeUser();
    await makeFamily(creator);
    await loginAs(creator);
    const res = await create({ family: 'false' });
    expect(res.status).toBe(200);
    expect((await res.json()).family_id).toBeNull();
  });
});

describe('邀请码: 作废', () => {
  it('作废自己未使用的码 → 200', async () => {
    await loginAs(await makeUser());
    const c = await (await create()).json();
    expect((await revoke(c.id)).status).toBe(200);
    const [[row]] = await dbApi.pool.query('SELECT revoked_at FROM invite_codes WHERE id = ?', [c.id]);
    expect(row.revoked_at).not.toBeNull();
  });

  it('作废别人的码 → 404，且那个码没被作废', async () => {
    const a = await makeUser();
    await loginAs(a);
    const c = await (await create()).json();
    await loginAs(await makeUser());
    expect((await revoke(c.id)).status).toBe(404);
    const [[row]] = await dbApi.pool.query('SELECT revoked_at FROM invite_codes WHERE id = ?', [c.id]);
    expect(row.revoked_at).toBeNull();
  });

  it('作废已被使用的码 → 400(用过的码不能再改)', async () => {
    const creator = await makeUser();
    const invitee = await makeUser();
    await loginAs(creator);
    const c = await (await create()).json();
    await dbApi.pool.execute('UPDATE invite_codes SET used_by = ?, used_at = NOW() WHERE id = ?', [invitee.id, c.id]);
    expect((await revoke(c.id)).status).toBe(400);
  });

  it('未登录 → 401；不存在的 id → 404', async () => {
    logout();
    expect((await revoke(1)).status).toBe(401);
    await loginAs(await makeUser());
    expect((await revoke(99999999)).status).toBe(404);
  });

  it('id 不是纯数字(1abc / abc / 0 / -1 / 空 / 超长)→ 400，不是 500', async () => {
    await loginAs(await makeUser());
    for (const id of ['1abc', 'abc', '0', '-1', '', '1.5', '9'.repeat(30)]) {
      expect((await revoke(id)).status).toBe(400);
    }
  });

  it('重复作废同一个码 → 仍是 200(幂等)，作废时间不被改写', async () => {
    await loginAs(await makeUser());
    const c = await (await create()).json();
    expect((await revoke(c.id)).status).toBe(200);
    const [[first]] = await dbApi.pool.query('SELECT revoked_at FROM invite_codes WHERE id = ?', [c.id]);
    expect((await revoke(c.id)).status).toBe(200);
    const [[second]] = await dbApi.pool.query('SELECT revoked_at FROM invite_codes WHERE id = ?', [c.id]);
    expect(second.revoked_at).toEqual(first.revoked_at);
  });
});

describe('邀请码: 外键级联', () => {
  it('删除发码人 → 他的码一并删除，但已用这些码注册的人不受影响', async () => {
    const creator = await makeUser();
    const invitee = await makeUser();
    await loginAs(creator);
    const c = await (await create()).json();
    await dbApi.pool.execute('UPDATE invite_codes SET used_by = ?, used_at = NOW() WHERE id = ?', [invitee.id, c.id]);
    await dbApi.deleteUser(creator.id);
    expect((await dbApi.pool.query('SELECT id FROM invite_codes WHERE id = ?', [c.id]))[0]).toHaveLength(0);
    expect((await dbApi.pool.query('SELECT id FROM users WHERE id = ?', [invitee.id]))[0]).toHaveLength(1);
  });

  it('删除使用者 → used_by 置空，但码仍是"已使用"，不会复活成可用', async () => {
    const creator = await makeUser();
    const invitee = await makeUser();
    await loginAs(creator);
    const c = await (await create()).json();
    await dbApi.pool.execute('UPDATE invite_codes SET used_by = ?, used_at = NOW() WHERE id = ?', [invitee.id, c.id]);
    await dbApi.deleteUser(invitee.id);
    const row = (await (await list()).json()).find((x) => x.id === c.id);
    expect(row.status).toBe('used');
    expect(await dbApi.peekInviteCode(c.code)).toBeNull();
  });
});
