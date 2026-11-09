// Q6: 每个请求以数据库为准，不信任 cookie 里缓存的 isAdmin / familyId / isFamilyCreator
import { describe, it, expect } from 'vitest';
import dbApi from '@/src/db.cjs';
import * as receiptsRoute from '@/app/api/receipts/route.js';
import * as meRoute from '@/app/api/auth/me/route.js';
import * as adminUsersRoute from '@/app/api/admin/users/route.js';
import * as inviteRoute from '@/app/api/family/invite/route.js';
import { makeUser, makeFamily, makeReceipt, loginAs, logout, req } from './helpers.js';

const ids = (rows) => rows.map((r) => r.id);

describe('会话实时校验', () => {
  it('未登录访问受保护接口 → 401', async () => {
    logout();
    const res = await receiptsRoute.GET(req('/api/receipts'));
    expect(res.status).toBe(401);
  });

  it('账号已被删除，旧 cookie 立即失效 → 401', async () => {
    const u = await makeUser();
    await loginAs(u);
    expect((await receiptsRoute.GET(req('/api/receipts'))).status).toBe(200);
    await dbApi.deleteUser(u.id);
    expect((await receiptsRoute.GET(req('/api/receipts'))).status).toBe(401);
    expect((await meRoute.GET(req('/api/auth/me'))).status).toBe(401);
  });

  it('管理员被撤权后，cookie 里的 isAdmin=true 不再生效 → 403', async () => {
    const u = await makeUser({ admin: true });
    await loginAs(u, { isAdmin: true });
    expect((await adminUsersRoute.GET(req('/api/admin/users'))).status).toBe(200);
    await dbApi.pool.execute('UPDATE users SET is_admin = 0 WHERE id = :id', { id: u.id });
    expect((await adminUsersRoute.GET(req('/api/admin/users'))).status).toBe(403);
  });

  it('cookie 伪称 isAdmin=true 但库里不是管理员 → 403', async () => {
    const u = await makeUser();
    await loginAs(u, { isAdmin: true });
    expect((await adminUsersRoute.GET(req('/api/admin/users'))).status).toBe(403);
  });

  it('库里刚被提升为管理员，无需重新登录即生效 → 200', async () => {
    const u = await makeUser();
    await loginAs(u, { isAdmin: false });
    await dbApi.pool.execute('UPDATE users SET is_admin = 1 WHERE id = :id', { id: u.id });
    expect((await adminUsersRoute.GET(req('/api/admin/users'))).status).toBe(200);
  });

  it('离开家庭后立即看不到原家庭成员的小票', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const familyId = await makeFamily(b, a);
    const bReceipt = await makeReceipt(b, { familyId });

    await loginAs(a, { familyId });
    expect(ids(await (await receiptsRoute.GET(req('/api/receipts'))).json())).toContain(bReceipt);

    await dbApi.pool.execute("UPDATE users SET family_id = NULL, account_type = 'individual' WHERE id = :id", { id: a.id });
    expect(ids(await (await receiptsRoute.GET(req('/api/receipts'))).json())).not.toContain(bReceipt);
  });

  it('cookie 伪造 familyId 也看不到别的家庭的小票', async () => {
    const owner = await makeUser();
    const familyId = await makeFamily(owner);
    const r = await makeReceipt(owner, { familyId });
    const stranger = await makeUser();
    await loginAs(stranger, { familyId });
    expect(ids(await (await receiptsRoute.GET(req('/api/receipts'))).json())).not.toContain(r);
  });

  it('cookie 伪称家庭创建者但库里不是 → 邀请接口 403', async () => {
    const creator = await makeUser();
    const member = await makeUser();
    const familyId = await makeFamily(creator, member);
    const target = await makeUser();
    await loginAs(member, { familyId, isFamilyCreator: true });
    const res = await inviteRoute.POST(req('/api/family/invite', { method: 'POST', body: { username: target.username } }));
    expect(res.status).toBe(403);
  });

  it('真正的家庭创建者可以邀请 → 200', async () => {
    const creator = await makeUser();
    await makeFamily(creator);
    const target = await makeUser();
    await loginAs(creator);
    const res = await inviteRoute.POST(req('/api/family/invite', { method: 'POST', body: { username: target.username } }));
    expect(res.status).toBe(200);
  });

  it('/api/auth/me 返回库里的最新家庭信息，而不是 cookie 缓存', async () => {
    const u = await makeUser();
    await loginAs(u, { familyId: 999999, familyName: 'stale', isFamilyCreator: true });
    const me = await (await meRoute.GET(req('/api/auth/me'))).json();
    expect(me.familyId).toBeNull();
    expect(me.familyName).toBeNull();
    expect(me.isFamilyCreator).toBe(false);
  });
});
