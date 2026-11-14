// issue #36: users.family_joined_at —— 每条"进家庭"的路径写 NOW()，每条"离开/被摘出"的路径清空；转让创建者不动它；
// 老库升级只加列、不回填(老成员保持 NULL，界面显示 —)
import { describe, it, expect } from 'vitest';
import dbApi from '@/src/db.cjs';
import { makeUser, uniq } from './helpers.js';

const joinedAt = async (id) => (await dbApi.pool.query('SELECT family_joined_at j, family_id f FROM users WHERE id = ?', [id]))[0][0];
const backdate = (id) => dbApi.pool.query("UPDATE users SET created_at = NOW() - INTERVAL 400 DAY WHERE id = ?", [id]);
const secondsAgo = async (id) => (await dbApi.pool.query('SELECT TIMESTAMPDIFF(SECOND, family_joined_at, NOW()) s FROM users WHERE id = ?', [id]))[0][0].s;
const expectJustJoined = async (id) => {
  const r = await joinedAt(id);
  expect(r.f).not.toBeNull();
  expect(r.j).not.toBeNull();
  expect(await secondsAgo(id)).toBeLessThan(30);
};
const expectCleared = async (id) => {
  const r = await joinedAt(id);
  expect(r.f).toBeNull();
  expect(r.j).toBeNull();
};
// 创建者 + 一个已入家庭的成员(成员的 family_joined_at 用 inviteMember 写入)
async function fam() {
  const creator = await makeUser();
  const member = await makeUser();
  await backdate(creator.id); await backdate(member.id);
  const familyId = await dbApi.createFamily(uniq('fam'), creator.id);
  expect(await dbApi.inviteMember(familyId, member.username)).toBe(true);
  return { creator, member, familyId };
}

describe('进家庭时写 family_joined_at(各条路径)', () => {
  it('createFamily: 创建者写入，且不等于注册时间', async () => {
    const u = await makeUser(); await backdate(u.id);
    expect(await joinedAt(u.id)).toMatchObject({ j: null });
    await dbApi.createFamily(uniq('fam'), u.id);
    await expectJustJoined(u.id);
    const m = (await dbApi.listFamilyMembers((await joinedAt(u.id)).f))[0];
    expect(m.family_joined_at).not.toBe(m.created_at);
  });
  it('inviteMember: 被邀请人写入', async () => {
    const { member } = await fam();
    await expectJustJoined(member.id);
  });
  it('inviteMember 找不到可邀请的人(已在家庭里): 不改动他原有的时间', async () => {
    const { member, familyId } = await fam();
    await dbApi.pool.query("UPDATE users SET family_joined_at = NOW() - INTERVAL 5 DAY WHERE id = ?", [member.id]);
    const before = (await joinedAt(member.id)).j;
    expect(await dbApi.inviteMember(familyId, member.username)).toBe(false);
    expect((await joinedAt(member.id)).j).toBe(before);
  });
  it('decideRequest 通过: 申请人写入；拒绝: 保持 NULL', async () => {
    const creator = await makeUser();
    const familyId = await dbApi.createFamily(uniq('fam'), creator.id);
    const a = await makeUser(); const b = await makeUser();
    await backdate(a.id);
    const ra = await dbApi.applyToFamily(familyId, a.id);
    const rb = await dbApi.applyToFamily(familyId, b.id);
    expect(await dbApi.decideRequest(ra, familyId, true, creator.id)).toBe(true);
    expect(await dbApi.decideRequest(rb, familyId, false, creator.id)).toBe(true);
    await expectJustJoined(a.id);
    expect(await joinedAt(b.id)).toMatchObject({ j: null, f: null });
  });
  it('decideRequest 通过但申请人已在别的家庭: 不覆盖他原来的时间', async () => {
    const creator = await makeUser();
    const familyId = await dbApi.createFamily(uniq('fam'), creator.id);
    const a = await makeUser();
    const rid = await dbApi.applyToFamily(familyId, a.id);
    await dbApi.createFamily(uniq('other'), a.id);
    await dbApi.pool.query("UPDATE users SET family_joined_at = NOW() - INTERVAL 5 DAY WHERE id = ?", [a.id]);
    const before = (await joinedAt(a.id)).j;
    expect(await dbApi.decideRequest(rid, familyId, true, creator.id)).toBe('applicant_in_family');
    expect((await joinedAt(a.id)).j).toBe(before);
  });
  it('registerWithInvite: 家庭邀请码注册写入；普通邀请码注册保持 NULL', async () => {
    const creator = await makeUser();
    const familyId = await dbApi.createFamily(uniq('fam'), creator.id);
    const fc = await dbApi.createInviteCode(creator.id, { familyId });
    const r1 = await dbApi.registerWithInvite(fc.code, uniq('fc'), 'hash');
    await expectJustJoined(r1.id);
    const pc = await dbApi.createInviteCode(creator.id);
    const r2 = await dbApi.registerWithInvite(pc.code, uniq('pc'), 'hash');
    expect(await joinedAt(r2.id)).toMatchObject({ j: null, f: null });
  });
});

describe('离开/被摘出时清空 family_joined_at(各条路径)', () => {
  it('leaveFamily(成员)', async () => {
    const { member } = await fam();
    expect(await dbApi.leaveFamily(member.id)).toBeTruthy();
    await expectCleared(member.id);
  });
  it('leaveFamily(只剩创建者一人 = 解散)', async () => {
    const u = await makeUser();
    await dbApi.createFamily(uniq('fam'), u.id);
    await dbApi.leaveFamily(u.id);
    await expectCleared(u.id);
  });
  it('removeMember: 被移除的人清空，其他成员不受影响', async () => {
    const { creator, member, familyId } = await fam();
    const other = await makeUser();
    await dbApi.inviteMember(familyId, other.username);
    expect(await dbApi.removeMember(familyId, creator.id, member.id)).toBeTruthy();
    await expectCleared(member.id);
    await expectJustJoined(other.id);
    await expectJustJoined(creator.id);
  });
  it('dissolveFamily: 所有成员清空', async () => {
    const { creator, member, familyId } = await fam();
    const name = (await dbApi.findFamilyById(familyId)).name;
    await dbApi.dissolveFamily(familyId, creator.id, name);
    await expectCleared(creator.id); await expectCleared(member.id);
  });
  it('管理员删除家庭创建者: 其他成员被摘出并清空', async () => {
    const { creator, member } = await fam();
    await dbApi.deleteUserFull(creator.id, { id: null, username: 'admin' });
    await expectCleared(member.id);
  });
});

describe('转让创建者不改变加入时间', () => {
  it('transferCreator 前后两人的 family_joined_at 不变', async () => {
    const { creator, member, familyId } = await fam();
    await dbApi.pool.query("UPDATE users SET family_joined_at = NOW() - INTERVAL 3 DAY WHERE id IN (?, ?)", [creator.id, member.id]);
    const b1 = (await joinedAt(creator.id)).j; const b2 = (await joinedAt(member.id)).j;
    expect(await dbApi.transferCreator(familyId, creator.id, member.id)).toBeTruthy();
    expect((await joinedAt(creator.id)).j).toBe(b1);
    expect((await joinedAt(member.id)).j).toBe(b2);
  });
});

describe('listFamilyMembers', () => {
  it('返回 family_joined_at：有值的是加入时间(≠ 注册时间)，老成员为 null', async () => {
    const { creator, member, familyId } = await fam();
    const old = await makeUser();
    await dbApi.pool.query("UPDATE users SET family_id = ?, account_type = 'family' WHERE id = ?", [familyId, old.id]); // 模拟升级前的老成员
    const rows = await dbApi.listFamilyMembers(familyId);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[member.id].family_joined_at).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
    expect(byId[member.id].family_joined_at).not.toBe(byId[member.id].created_at);
    expect(byId[creator.id].family_joined_at).not.toBeNull();
    expect(byId[old.id].family_joined_at).toBeNull();
  });
});
