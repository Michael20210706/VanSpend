// P1 / Q28: 升级路径——已有库的 users 表没有 signup_source / scan_tier / invited_by 时，迁移补列，
// 老账号取默认值(邀请注册、正常额度)，不丢数据；重复执行是空操作
import { describe, it, expect } from 'vitest';
import dbApi from '@/src/db.cjs';
import { makeUser } from './helpers.js';

const cols = async () => (await dbApi.pool.query(
  "SELECT COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'"))[0].map((r) => r.c);

describe('users 邀请/额度列的升级迁移', () => {
  it('旧结构(没有这三列)→ 迁移后补齐，老账号是 invite / normal / 无邀请人，数据不丢', async () => {
    const old = await makeUser({ tier: 'open' });
    // 把 users 退回到旧结构
    await dbApi.pool.query('ALTER TABLE users DROP FOREIGN KEY fk_users_invited_by');
    await dbApi.pool.query('ALTER TABLE users DROP COLUMN invited_by, DROP COLUMN scan_tier, DROP COLUMN signup_source');
    expect(await cols()).not.toContain('scan_tier');

    const conn = await dbApi.pool.getConnection();
    try {
      await dbApi.migrateUsersInviteColumns(conn);
      await dbApi.migrateUsersInviteColumns(conn); // 幂等: 第二次什么都不做、也不报错
    } finally {
      conn.release();
    }

    expect(await cols()).toEqual(expect.arrayContaining(['signup_source', 'scan_tier', 'invited_by']));
    const [[u]] = await dbApi.pool.query('SELECT * FROM users WHERE id = ?', [old.id]);
    expect(u.username).toBe(old.username);
    expect(u).toMatchObject({ signup_source: 'invite', scan_tier: 'normal', invited_by: null });
    // 外键回来了: 删除邀请人 → invited_by 置空而不是连带删除被邀请人
    const inviter = await makeUser();
    const invitee = await makeUser();
    await dbApi.pool.execute('UPDATE users SET invited_by = ? WHERE id = ?', [inviter.id, invitee.id]);
    await dbApi.deleteUser(inviter.id);
    const [[after]] = await dbApi.pool.query('SELECT invited_by FROM users WHERE id = ?', [invitee.id]);
    expect(after.invited_by).toBeNull();
  });

  it('只补了一半列(有 signup_source，没有 scan_tier / invited_by)也能补完整', async () => {
    await dbApi.pool.query('ALTER TABLE users DROP FOREIGN KEY fk_users_invited_by');
    await dbApi.pool.query('ALTER TABLE users DROP COLUMN invited_by, DROP COLUMN scan_tier');
    const conn = await dbApi.pool.getConnection();
    try {
      await dbApi.migrateUsersInviteColumns(conn);
    } finally {
      conn.release();
    }
    expect(await cols()).toEqual(expect.arrayContaining(['signup_source', 'scan_tier', 'invited_by']));
  });
});

// P4: users.must_change_password 的升级迁移(老库没有这一列)
describe('users.must_change_password 的升级迁移', () => {
  it('旧结构(没有这一列)→ 迁移后补齐，老账号默认 0、数据不丢；重复执行是空操作', async () => {
    const old = await makeUser();
    await dbApi.pool.query('ALTER TABLE users DROP COLUMN must_change_password');
    expect(await cols()).not.toContain('must_change_password');
    const conn = await dbApi.pool.getConnection();
    try {
      await dbApi.migrateUsersPasswordFlag(conn);
      await dbApi.migrateUsersPasswordFlag(conn);
    } finally {
      conn.release();
    }
    expect(await cols()).toContain('must_change_password');
    const [[u]] = await dbApi.pool.query('SELECT username, must_change_password FROM users WHERE id = ?', [old.id]);
    expect(u).toMatchObject({ username: old.username, must_change_password: 0 });
  });
});

// issue #36: users.family_joined_at 的升级迁移——只加列，老成员保持 NULL(不拿注册时间回填)
describe('users.family_joined_at 的升级迁移', () => {
  it('旧结构(没有这一列)→ 迁移后补齐，老成员为 NULL、家庭归属和注册时间不动；重复执行是空操作', async () => {
    const creator = await makeUser();
    const member = await makeUser();
    const familyId = await dbApi.createFamily(`fam_${creator.id}_${Date.now()}`, creator.id);
    await dbApi.inviteMember(familyId, member.username);
    const [[before]] = await dbApi.pool.query('SELECT created_at, family_id FROM users WHERE id = ?', [member.id]);
    await dbApi.pool.query('ALTER TABLE users DROP COLUMN family_joined_at');
    expect(await cols()).not.toContain('family_joined_at');
    const conn = await dbApi.pool.getConnection();
    try {
      await dbApi.migrateUsersFamilyJoinedAt(conn);
      await dbApi.migrateUsersFamilyJoinedAt(conn);
    } finally {
      conn.release();
    }
    expect(await cols()).toContain('family_joined_at');
    const [[after]] = await dbApi.pool.query('SELECT created_at, family_id, family_joined_at FROM users WHERE id = ?', [member.id]);
    expect(after).toEqual({ ...before, family_joined_at: null });
    // 迁移后再加入家庭，正常写值
    const late = await makeUser();
    await dbApi.inviteMember(familyId, late.username);
    const [[l]] = await dbApi.pool.query('SELECT family_joined_at FROM users WHERE id = ?', [late.id]);
    expect(l.family_joined_at).not.toBeNull();
  });
});
