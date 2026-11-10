// P2 / Q9-Q11: 家庭管理补全——成员退出、创建者移除成员、转让创建者、解散家庭、撤回申请、家庭改名；
// 离开家庭的人，其小票及明细的 family_id 清空(跟人走)；创建者必须先转让才能退出，只剩一人时退出即解散
import { describe, it, expect } from 'vitest';
import dbApi from '@/src/db.cjs';
import * as leaveRoute from '@/app/api/family/leave/route.js';
import * as memberRoute from '@/app/api/family/members/[id]/route.js';
import * as transferRoute from '@/app/api/family/transfer/route.js';
import * as dissolveRoute from '@/app/api/family/dissolve/route.js';
import * as familyRoute from '@/app/api/family/route.js';
import * as applyRoute from '@/app/api/family/apply/route.js';
import * as applicationRoute from '@/app/api/family/applications/[id]/route.js';
import * as decideRoute from '@/app/api/family/requests/[id]/route.js';
import * as inviteUserRoute from '@/app/api/family/invite/route.js';
import * as meRoute from '@/app/api/family/me/route.js';
import * as invitesRoute from '@/app/api/invites/route.js';
import { makeUser, makeFamily, loginAs, logout, req, ctx, uniq } from './helpers.js';

const post = (route, body = {}) => route.POST(req('/x', { method: 'POST', body }));
const leave = () => post(leaveRoute);
const removeMember = (id) => memberRoute.DELETE(req('/x', { method: 'DELETE' }), ctx({ id: String(id) }));
const transfer = (userId) => post(transferRoute, { userId });
const dissolve = (name) => post(dissolveRoute, { name });
const rename = (name) => familyRoute.PATCH(req('/x', { method: 'PATCH', body: { name } }));
const withdraw = (id) => applicationRoute.DELETE(req('/x', { method: 'DELETE' }), ctx({ id: String(id) }));
const me = async () => (await meRoute.GET(req('/x'))).json();

const userRow = async (id) => (await dbApi.pool.query('SELECT * FROM users WHERE id = ?', [id]))[0][0];
const familyRowById = async (id) => (await dbApi.pool.query('SELECT * FROM families WHERE id = ?', [id]))[0][0];
const receiptRow = async (id) => (await dbApi.pool.query('SELECT * FROM receipts WHERE id = ?', [id]))[0][0];
const itemRows = async (receiptId) => (await dbApi.pool.query('SELECT * FROM items WHERE receipt_id = ?', [receiptId]))[0];

// 以家庭身份保存的小票(带 family_name，明细也会带上)
async function familyReceipt(user, familyId, familyName) {
  return dbApi.saveReceipt(
    { user_id: user.id, family_id: familyId, family_name: familyName, account_type: 'family', store: '__FAM', purchased_at: '2026-05-01',
      currency: 'CAD', subtotal: 10, gst: 0, pst: 0, total: 10, image_file: null, raw_json: '{}' },
    [{ name_raw: 'X', name_norm: 'x', category: '其他', subcategory: null, qty: 1, unit: null, unit_price: 10, amount: 10, taxable: 0 }]
  );
}
const nameOf = async (familyId) => (await familyRowById(familyId)).name;

// 创建者 + n 个成员，每人各有一张家庭小票
async function setup(n = 2) {
  const creator = await makeUser();
  const members = [];
  for (let i = 0; i < n; i++) members.push(await makeUser());
  const familyId = await makeFamily(creator, ...members);
  const name = await nameOf(familyId);
  const receipts = {};
  for (const u of [creator, ...members]) receipts[u.id] = await familyReceipt(u, familyId, name);
  return { creator, members, familyId, name, receipts };
}

describe('成员退出家庭', () => {
  it('未登录 → 401；没有家庭 → 400', async () => {
    logout();
    expect((await leave()).status).toBe(401);
    await loginAs(await makeUser());
    expect((await leave()).status).toBe(400);
  });

  it('普通成员退出 → 200，变回个人账号，其他人不受影响', async () => {
    const { creator, members, familyId } = await setup(2);
    await loginAs(members[0]);
    const res = await leave();
    expect(res.status).toBe(200);
    expect((await res.json()).dissolved).toBe(false);
    expect(await userRow(members[0].id)).toMatchObject({ family_id: null, account_type: 'individual' });
    expect(await userRow(members[1].id)).toMatchObject({ family_id: familyId, account_type: 'family' });
    expect((await familyRowById(familyId)).creator_id).toBe(creator.id);
    expect((await me()).family).toBeNull(); // 下一个请求立刻生效，不用重新登录
  });

  it('退出的人其小票及明细 family_id/family_name 清空(跟人走)，所有者不变；别人的家庭小票不动', async () => {
    const { creator, members, familyId, receipts } = await setup(2);
    await loginAs(members[0]);
    await leave();
    const mine = await receiptRow(receipts[members[0].id]);
    expect(mine).toMatchObject({ user_id: members[0].id, family_id: null, family_name: null, account_type: 'individual' });
    for (const it of await itemRows(mine.id)) expect(it).toMatchObject({ family_id: null, family_name: null, account_type: 'individual' });
    const theirs = await receiptRow(receipts[creator.id]);
    expect(theirs.family_id).toBe(familyId);
    expect((await itemRows(theirs.id))[0].family_id).toBe(familyId);
  });

  it('退出后: 原家庭成员看不到他的小票，他自己仍看得到全部自己的小票', async () => {
    const { creator, members, receipts } = await setup(2);
    const listIds = async () => (await (await (await import('@/app/api/receipts/route.js')).GET(req('/api/receipts'))).json()).map((r) => r.id);
    await loginAs(creator);
    expect(await listIds()).toContain(receipts[members[0].id]);
    await loginAs(members[0]);
    await leave();
    expect(await listIds()).toEqual([receipts[members[0].id]]); // 只剩自己的
    await loginAs(creator);
    const ids = await listIds();
    expect(ids).not.toContain(receipts[members[0].id]);
    expect(ids).toContain(receipts[members[1].id]);
  });

  it('创建者在还有其他成员时退出 → 400，什么都不变', async () => {
    const { creator, familyId } = await setup(1);
    await loginAs(creator);
    const res = await leave();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/转让/);
    expect(await userRow(creator.id)).toMatchObject({ family_id: familyId });
    expect(await familyRowById(familyId)).toBeDefined();
  });

  it('创建者独自一人时退出 = 解散家庭 → 200 dissolved，家庭记录删除，小票归自己', async () => {
    const creator = await makeUser();
    const familyId = await makeFamily(creator);
    const rid = await familyReceipt(creator, familyId, await nameOf(familyId));
    await loginAs(creator);
    const res = await leave();
    expect(res.status).toBe(200);
    expect((await res.json()).dissolved).toBe(true);
    expect(await familyRowById(familyId)).toBeUndefined();
    expect(await userRow(creator.id)).toMatchObject({ family_id: null, account_type: 'individual' });
    expect(await receiptRow(rid)).toMatchObject({ user_id: creator.id, family_id: null, family_name: null });
  });

  it('转让之后，原创建者可以正常退出', async () => {
    const { creator, members, familyId } = await setup(1);
    await loginAs(creator);
    expect((await transfer(members[0].id)).status).toBe(200);
    expect((await leave()).status).toBe(200);
    expect(await userRow(creator.id)).toMatchObject({ family_id: null });
    expect((await familyRowById(familyId)).creator_id).toBe(members[0].id);
  });

  it('退出后可以再创建新家庭 / 申请别的家庭', async () => {
    const { members } = await setup(1);
    await loginAs(members[0]);
    await leave();
    const created = await familyRoute.POST(req('/x', { method: 'POST', body: { name: uniq('again') } }));
    expect(created.status).toBe(200);
  });

  it('并发: 同一个成员同时点 5 次退出 → 恰好一次 200，其余 400，没有 500', async () => {
    const { members } = await setup(1);
    await loginAs(members[0]);
    const statuses = (await Promise.all(Array.from({ length: 5 }, () => leave()))).map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 400)).toHaveLength(4);
  });
});

describe('创建者移除成员', () => {
  it('创建者移除成员 → 200，对方变回个人，小票跟人走', async () => {
    const { creator, members, familyId, receipts } = await setup(2);
    await loginAs(creator);
    expect((await removeMember(members[0].id)).status).toBe(200);
    expect(await userRow(members[0].id)).toMatchObject({ family_id: null, account_type: 'individual' });
    expect(await receiptRow(receipts[members[0].id])).toMatchObject({ user_id: members[0].id, family_id: null, family_name: null });
    expect((await itemRows(receipts[members[0].id]))[0].family_id).toBeNull();
    expect(await userRow(members[1].id)).toMatchObject({ family_id: familyId });
    expect(await receiptRow(receipts[creator.id])).toMatchObject({ family_id: familyId });
  });

  it('被移除者下一个请求就不再有家庭权限(不用重新登录)', async () => {
    const { creator, members } = await setup(2);
    await loginAs(creator);
    await removeMember(members[0].id);
    await loginAs(members[0], { familyId: 12345, isFamilyCreator: true }); // cookie 里缓存的旧值
    expect((await me()).family).toBeNull();
    expect((await inviteUserRoute.POST(req('/x', { method: 'POST', body: { username: 'x' } }))).status).toBe(403);
  });

  it('普通成员移除别人 → 403，没有任何变化', async () => {
    const { members, familyId } = await setup(2);
    await loginAs(members[0]);
    expect((await removeMember(members[1].id)).status).toBe(403);
    expect(await userRow(members[1].id)).toMatchObject({ family_id: familyId });
  });

  it('创建者移除自己 → 400(要用"退出"或"解散")', async () => {
    const { creator, familyId } = await setup(1);
    await loginAs(creator);
    expect((await removeMember(creator.id)).status).toBe(400);
    expect(await userRow(creator.id)).toMatchObject({ family_id: familyId });
  });

  it('移除别的家庭的成员 / 没有家庭的人 / 不存在的人 → 404，且对方不受影响', async () => {
    const a = await setup(1);
    const b = await setup(1);
    const loner = await makeUser();
    await loginAs(a.creator);
    expect((await removeMember(b.members[0].id)).status).toBe(404);
    expect((await removeMember(loner.id)).status).toBe(404);
    expect((await removeMember(99999999)).status).toBe(404);
    expect(await userRow(b.members[0].id)).toMatchObject({ family_id: b.familyId });
  });

  it('id 不是纯数字 → 400；未登录 → 401；不是创建者的家庭外用户 → 403', async () => {
    const { creator } = await setup(1);
    await loginAs(creator);
    for (const id of ['abc', '1abc', '0', '-1']) expect((await removeMember(id)).status).toBe(400);
    logout();
    expect((await removeMember(1)).status).toBe(401);
    await loginAs(await makeUser());
    expect((await removeMember(1)).status).toBe(403);
  });
});

describe('转让创建者', () => {
  it('创建者转让给成员 → 200，身份立即互换', async () => {
    const { creator, members, familyId } = await setup(2);
    await loginAs(creator);
    expect((await transfer(members[0].id)).status).toBe(200);
    expect((await familyRowById(familyId)).creator_id).toBe(members[0].id);
    expect((await me()).isCreator).toBe(false);
    await loginAs(members[0]);
    expect((await me()).isCreator).toBe(true);
  });

  it('转让后: 新创建者能邀请/审核，原创建者不能', async () => {
    const { creator, members } = await setup(1);
    const target = await makeUser();
    await loginAs(creator);
    await transfer(members[0].id);
    expect((await inviteUserRoute.POST(req('/x', { method: 'POST', body: { username: target.username } }))).status).toBe(403);
    await loginAs(members[0]);
    expect((await inviteUserRoute.POST(req('/x', { method: 'POST', body: { username: target.username } }))).status).toBe(200);
  });

  it('转让后: 原创建者未使用的家庭邀请码被作废，已使用的不受影响，新创建者可生成自己的', async () => {
    const { creator, members } = await setup(1);
    const invitee = await makeUser();
    await loginAs(creator);
    const unused = await (await invitesRoute.POST(req('/x', { method: 'POST', body: { family: true } }))).json();
    const used = await (await invitesRoute.POST(req('/x', { method: 'POST', body: { family: true } }))).json();
    const plain = await (await invitesRoute.POST(req('/x', { method: 'POST', body: {} }))).json();
    await dbApi.pool.execute('UPDATE invite_codes SET used_by = ?, used_at = NOW() WHERE id = ?', [invitee.id, used.id]);
    await transfer(members[0].id);
    const status = async (id) => (await dbApi.pool.query(
      `SELECT CASE WHEN used_by IS NOT NULL THEN 'used' WHEN revoked_at IS NOT NULL THEN 'revoked' ELSE 'unused' END s FROM invite_codes WHERE id = ?`, [id]))[0][0].s;
    expect(await status(unused.id)).toBe('revoked');
    expect(await dbApi.peekInviteCode(unused.code)).toBeNull();
    expect(await status(used.id)).toBe('used');
    expect(await status(plain.id)).toBe('unused'); // 普通码只管注册，和家庭无关
    await loginAs(members[0]);
    expect((await invitesRoute.POST(req('/x', { method: 'POST', body: { family: true } }))).status).toBe(200);
  });

  it('转让后: 原创建者不能再批准加入申请，新创建者可以', async () => {
    const { creator, members, name } = await setup(1);
    const applicant = await makeUser();
    await loginAs(applicant);
    await applyRoute.POST(req('/x', { method: 'POST', body: { name } }));
    const [[{ id: reqId }]] = await dbApi.pool.query('SELECT id FROM family_join_requests WHERE user_id = ?', [applicant.id]);
    await loginAs(creator);
    await transfer(members[0].id);
    const decide = () => decideRoute.POST(req('/x', { method: 'POST', body: { decision: 'approve' } }), ctx({ id: String(reqId) }));
    expect((await decide()).status).toBe(403);
    await loginAs(members[0]);
    expect((await decide()).status).toBe(200);
  });

  it('转让给不在本家庭的人(无家庭 / 别的家庭)/ 自己 / 不存在的人 → 400，不变', async () => {
    const { creator, familyId } = await setup(1);
    const other = await setup(1);
    const loner = await makeUser();
    await loginAs(creator);
    for (const userId of [loner.id, other.members[0].id, creator.id, 99999999]) {
      expect((await transfer(userId)).status).toBe(400);
    }
    expect((await familyRowById(familyId)).creator_id).toBe(creator.id);
  });

  it('userId 不是整数(字符串 / 数组 / 缺失)→ 400', async () => {
    const { creator, members } = await setup(1);
    await loginAs(creator);
    for (const userId of ['abc', [members[0].id], {}, undefined, null, 1.5]) {
      expect((await transfer(userId)).status).toBe(400);
    }
  });

  it('非创建者 → 403；未登录 → 401', async () => {
    const { creator, members } = await setup(2);
    await loginAs(members[0]);
    expect((await transfer(members[1].id)).status).toBe(403);
    logout();
    expect((await transfer(creator.id)).status).toBe(401);
  });
});

describe('解散家庭', () => {
  it('名字不对 / 没传名字 → 400，家庭不动', async () => {
    const { creator, familyId } = await setup(1);
    await loginAs(creator);
    expect((await dissolve('不是这个名字')).status).toBe(400);
    expect((await dissolve(undefined)).status).toBe(400);
    expect((await dissolve(['x'])).status).toBe(400);
    expect(await familyRowById(familyId)).toBeDefined();
  });

  it('名字正确 → 200: 家庭删除，所有成员变回个人，小票及明细 family_id 清空但所有者不变，家庭码/申请一并清除', async () => {
    const { creator, members, familyId, name, receipts } = await setup(2);
    await loginAs(creator);
    const code = await (await invitesRoute.POST(req('/x', { method: 'POST', body: { family: true } }))).json();
    const applicant = await makeUser();
    await loginAs(applicant);
    await applyRoute.POST(req('/x', { method: 'POST', body: { name } }));
    await loginAs(creator);

    const res = await dissolve(name);
    expect(res.status).toBe(200);
    expect(await familyRowById(familyId)).toBeUndefined();
    for (const u of [creator, ...members]) {
      expect(await userRow(u.id)).toMatchObject({ family_id: null, account_type: 'individual' });
      expect(await receiptRow(receipts[u.id])).toMatchObject({ user_id: u.id, family_id: null, family_name: null, account_type: 'individual' });
      for (const it of await itemRows(receipts[u.id])) expect(it).toMatchObject({ family_id: null, family_name: null });
    }
    expect((await dbApi.pool.query('SELECT id FROM invite_codes WHERE id = ?', [code.id]))[0]).toHaveLength(0);
    expect((await dbApi.pool.query('SELECT id FROM family_join_requests WHERE family_id = ?', [familyId]))[0]).toHaveLength(0);
    expect(await dbApi.findFamilyByName(name)).toBeNull(); // 名字可以重新使用
  });

  it('解散后每个人仍能看到自己的全部小票，看不到别人的', async () => {
    const { creator, members, name, receipts } = await setup(1);
    const list = async () => (await (await (await import('@/app/api/receipts/route.js')).GET(req('/x'))).json()).map((r) => r.id);
    await loginAs(creator);
    await dissolve(name);
    expect(await list()).toEqual([receipts[creator.id]]);
    await loginAs(members[0]);
    expect(await list()).toEqual([receipts[members[0].id]]);
  });

  it('非创建者 → 403；未登录 → 401；没有家庭的人 → 403', async () => {
    const { members, name, familyId } = await setup(1);
    await loginAs(members[0]);
    expect((await dissolve(name)).status).toBe(403);
    expect(await familyRowById(familyId)).toBeDefined();
    logout();
    expect((await dissolve(name)).status).toBe(401);
    await loginAs(await makeUser());
    expect((await dissolve(name)).status).toBe(403);
  });

  it('解散后创建者可以用同一个名字重新建家庭', async () => {
    const { creator, name } = await setup(1);
    await loginAs(creator);
    await dissolve(name);
    expect((await familyRoute.POST(req('/x', { method: 'POST', body: { name } }))).status).toBe(200);
  });
});

describe('家庭改名', () => {
  it('创建者改名 → 200，成员立即看到新名字，历史小票/明细里冗余的 family_name 同步更新', async () => {
    const { creator, members, familyId, receipts } = await setup(1);
    const newName = uniq('renamed');
    await loginAs(creator);
    expect((await rename(`  ${newName}  `)).status).toBe(200); // 首尾空格被去掉
    expect(await nameOf(familyId)).toBe(newName);
    expect((await receiptRow(receipts[members[0].id])).family_name).toBe(newName);
    expect((await itemRows(receipts[members[0].id]))[0].family_name).toBe(newName);
    await loginAs(members[0]);
    expect((await me()).family.name).toBe(newName);
  });

  it('改成别的家庭已用的名字 → 400，原名不变；改成自己现在的名字 → 200(幂等)', async () => {
    const a = await setup(1);
    const b = await setup(1);
    await loginAs(a.creator);
    expect((await rename(b.name)).status).toBe(400);
    expect(await nameOf(a.familyId)).toBe(a.name);
    expect((await rename(a.name)).status).toBe(200);
  });

  it('空名字 / 只有空格 / 超过 100 字 / 不是字符串 → 400', async () => {
    const { creator, name, familyId } = await setup(1);
    await loginAs(creator);
    for (const bad of ['', '   ', 'x'.repeat(101), ['a'], 5, null, undefined]) {
      expect((await rename(bad)).status).toBe(400);
    }
    expect(await nameOf(familyId)).toBe(name);
    expect((await rename('y'.repeat(100))).status).toBe(200); // 恰好 100 字可以
  });

  it('非创建者 → 403；没有家庭 → 403；未登录 → 401', async () => {
    const { members, name, familyId } = await setup(1);
    await loginAs(members[0]);
    expect((await rename(uniq('x'))).status).toBe(403);
    expect(await nameOf(familyId)).toBe(name);
    await loginAs(await makeUser());
    expect((await rename(uniq('x'))).status).toBe(403);
    logout();
    expect((await rename(uniq('x'))).status).toBe(401);
  });

  it('并发改成同一个新名字的两个家庭 → 恰好一个成功，另一个 400，没有 500', async () => {
    const a = await setup(1);
    const b = await setup(1);
    const target = uniq('clash');
    await loginAs(a.creator);
    const ra = rename(target);
    // 第二个请求需要 b 的会话: 会话是进程内共用的 cookie 罐，所以串行切换身份后再并发发出
    const first = await ra;
    await loginAs(b.creator);
    const second = await rename(target);
    expect([first.status, second.status].sort()).toEqual([200, 400]);
  });
});

describe('撤回加入申请', () => {
  const apply = async (user, name) => {
    await loginAs(user);
    expect((await applyRoute.POST(req('/x', { method: 'POST', body: { name } }))).status).toBe(200);
    return (await dbApi.pool.query('SELECT id FROM family_join_requests WHERE user_id = ? AND status = ?', [user.id, 'pending']))[0][0].id;
  };

  it('申请人撤回自己的待审申请 → 200，创建者的待审列表里消失，之后无法再批准', async () => {
    const { creator, name } = await setup(1);
    const applicant = await makeUser();
    const id = await apply(applicant, name);
    expect((await withdraw(id)).status).toBe(200);
    await loginAs(creator);
    expect((await me()).pendingRequests).toHaveLength(0);
    expect((await decideRoute.POST(req('/x', { method: 'POST', body: { decision: 'approve' } }), ctx({ id: String(id) }))).status).toBe(404);
  });

  it('没有家庭的用户在 /api/family/me 里能看到自己的待审申请(含家庭名)', async () => {
    const { name } = await setup(1);
    const applicant = await makeUser();
    const id = await apply(applicant, name);
    const body = await me();
    expect(body.family).toBeNull();
    expect(body.myApplications).toEqual([expect.objectContaining({ id, family_name: name })]);
  });

  it('撤回别人的申请 → 404，申请还在', async () => {
    const { name } = await setup(1);
    const applicant = await makeUser();
    const id = await apply(applicant, name);
    await loginAs(await makeUser());
    expect((await withdraw(id)).status).toBe(404);
    expect((await dbApi.pool.query('SELECT id FROM family_join_requests WHERE id = ?', [id]))[0]).toHaveLength(1);
  });

  it('创建者不能替别人撤回(这个接口只认申请人自己)', async () => {
    const { creator, name } = await setup(1);
    const applicant = await makeUser();
    const id = await apply(applicant, name);
    await loginAs(creator);
    expect((await withdraw(id)).status).toBe(404);
  });

  it('已经被处理(通过/拒绝)的申请不能撤回 → 404；不存在 → 404；非法 id → 400；未登录 → 401', async () => {
    const { creator, name } = await setup(1);
    const applicant = await makeUser();
    const id = await apply(applicant, name);
    await loginAs(creator);
    await decideRoute.POST(req('/x', { method: 'POST', body: { decision: 'reject' } }), ctx({ id: String(id) }));
    await loginAs(applicant);
    expect((await withdraw(id)).status).toBe(404);
    expect((await withdraw(99999999)).status).toBe(404);
    for (const bad of ['abc', '1abc', '0']) expect((await withdraw(bad)).status).toBe(400);
    logout();
    expect((await withdraw(id)).status).toBe(401);
  });

  it('撤回后可以重新申请', async () => {
    const { name } = await setup(1);
    const applicant = await makeUser();
    const id = await apply(applicant, name);
    await withdraw(id);
    expect((await applyRoute.POST(req('/x', { method: 'POST', body: { name } }))).status).toBe(200);
  });
});

describe('管理员删除家庭创建者的账号', () => {
  it('家庭被一并清理: 其他成员变回个人账号，小票/明细摘掉家庭归属，所有者不变；创建者自己的数据随账号删除', async () => {
    const { creator, members, familyId, receipts } = await setup(2);
    expect(await dbApi.deleteUser(creator.id)).toBe(1);
    expect(await familyRowById(familyId)).toBeUndefined();
    for (const u of members) {
      expect(await userRow(u.id)).toMatchObject({ family_id: null, account_type: 'individual' });
      expect(await receiptRow(receipts[u.id])).toMatchObject({ user_id: u.id, family_id: null, family_name: null, account_type: 'individual' });
      for (const it of await itemRows(receipts[u.id])) expect(it).toMatchObject({ family_id: null, family_name: null, account_type: 'individual' });
    }
    expect(await receiptRow(receipts[creator.id])).toBeUndefined();
  });

  it('删除普通成员的账号: 家庭和其他成员不受影响', async () => {
    const { creator, members, familyId, receipts } = await setup(2);
    await dbApi.deleteUser(members[0].id);
    expect(await familyRowById(familyId)).toBeDefined();
    expect(await userRow(creator.id)).toMatchObject({ family_id: familyId, account_type: 'family' });
    expect(await receiptRow(receipts[members[1].id])).toMatchObject({ family_id: familyId });
  });

  it('删除没有家庭的用户 / 不存在的用户: 行为不变', async () => {
    const u = await makeUser();
    expect(await dbApi.deleteUser(u.id)).toBe(1);
    expect(await dbApi.deleteUser(99999999)).toBe(0);
  });
});

describe('/api/family/me', () => {
  it('返回当前用户 id(界面用它标出"你自己"这一行)', async () => {
    const { creator } = await setup(1);
    await loginAs(creator);
    expect((await me()).userId).toBe(creator.id);
  });

  it('在家庭里时 myApplications 为空数组；成员列表不含已离开的人', async () => {
    const { creator, members } = await setup(2);
    await loginAs(members[0]);
    await leave();
    await loginAs(creator);
    const body = await me();
    expect(body.members.map((m) => m.id).sort()).toEqual([creator.id, members[1].id].sort());
    expect(body.myApplications).toEqual([]);
  });
});
