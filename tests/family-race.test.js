// P2 验证发现的竞态: 保存小票的请求在解析请求体之前读了会话，如果这期间发生了退出/移除/改名/解散，
// 旧做法会留下"家庭归属已过期"的小票。现在 saveReceipt({ stampFamilyFromDb: true }) 在事务里按数据库当前值盖章。
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import dbApi from '@/src/db.cjs';
import * as receiptsRoute from '@/app/api/receipts/route.js';
import * as familyRoute from '@/app/api/family/route.js';
import * as uploadsRoute from '@/app/uploads/[...file]/route.js';
import * as leaveRoute from '@/app/api/family/leave/route.js';
import * as dissolveRoute from '@/app/api/family/dissolve/route.js';
import * as memberRoute from '@/app/api/family/members/[id]/route.js';
import * as transferRoute from '@/app/api/family/transfer/route.js';
import { makeUser, makeFamily, makeReceipt, loginAs, logout, req, ctx, uniq } from './helpers.js';

const row = async (table, id) => (await dbApi.pool.query(`SELECT * FROM ${table} WHERE id = ?`, [id]))[0][0];
const itemsOf = async (rid) => (await dbApi.pool.query('SELECT * FROM items WHERE receipt_id = ?', [rid]))[0];
const familyName = async (id) => (await dbApi.pool.query('SELECT name FROM families WHERE id = ?', [id]))[0][0].name;

const receipt = (userId, extra = {}) => ({
  user_id: userId, store: '__RACE', purchased_at: '2026-05-01', currency: 'CAD', subtotal: 9, gst: 0, pst: 0, total: 9,
  image_file: null, raw_json: '{}', ...extra,
});
const items = [{ name_raw: 'X', name_norm: 'x', category: '其他', subcategory: null, qty: 1, unit: null, unit_price: 9, amount: 9, taxable: 0 }];
// 模拟"会话里读到的旧家庭信息"
const stale = (familyId, name) => ({ family_id: familyId, family_name: name, family_role: 'dad', account_type: 'family' });
const stamped = (userId, extra) => dbApi.saveReceipt(receipt(userId, extra), items, { stampFamilyFromDb: true });

describe('saveReceipt 按数据库当前值盖章家庭归属', () => {
  it('在家庭里的成员保存 → 带上当前家庭的 id/名字/角色，明细同样', async () => {
    const creator = await makeUser();
    const member = await makeUser();
    const familyId = await makeFamily(creator, member);
    await dbApi.pool.execute("UPDATE users SET family_role = 'mom' WHERE id = ?", [member.id]);
    const rid = await stamped(member.id);
    expect(await row('receipts', rid)).toMatchObject({ family_id: familyId, family_name: await familyName(familyId), family_role: 'mom', account_type: 'family' });
    expect((await itemsOf(rid))[0]).toMatchObject({ family_id: familyId, family_name: await familyName(familyId), account_type: 'family' });
  });

  it('没有家庭的用户保存 → 个人小票', async () => {
    const u = await makeUser();
    const rid = await stamped(u.id);
    expect(await row('receipts', rid)).toMatchObject({ family_id: null, family_name: null, account_type: 'individual' });
  });

  it('调用方给的家庭字段(会话里的旧值 / 请求体里伪造的)一律被忽略', async () => {
    const creator = await makeUser();
    const other = await makeUser();
    const otherFamily = await makeFamily(other);
    const familyId = await makeFamily(creator);
    const rid = await stamped(creator.id, stale(otherFamily, 'forged'));
    expect(await row('receipts', rid)).toMatchObject({ family_id: familyId, family_name: await familyName(familyId) });
    const loner = await makeUser();
    const rid2 = await stamped(loner.id, stale(otherFamily, 'forged'));
    expect(await row('receipts', rid2)).toMatchObject({ family_id: null, family_name: null, account_type: 'individual' });
  });

  it('成员已被移除，但调用方还拿着旧的家庭信息 → 存成个人小票(不再对原家庭可见)', async () => {
    const creator = await makeUser();
    const member = await makeUser();
    const familyId = await makeFamily(creator, member);
    const name = await familyName(familyId);
    expect(await dbApi.removeMember(familyId, creator.id, member.id)).toBe('removed');
    const rid = await stamped(member.id, stale(familyId, name));
    expect(await row('receipts', rid)).toMatchObject({ user_id: member.id, family_id: null, family_name: null, account_type: 'individual' });
    expect((await itemsOf(rid))[0]).toMatchObject({ family_id: null, family_name: null });
  });

  it('家庭已改名，但调用方拿着旧名字 → 存当前的名字', async () => {
    const creator = await makeUser();
    const familyId = await makeFamily(creator);
    const oldName = await familyName(familyId);
    const newName = uniq('renamed');
    await dbApi.renameFamily(familyId, creator.id, newName);
    const rid = await stamped(creator.id, stale(familyId, oldName));
    expect((await row('receipts', rid)).family_name).toBe(newName);
    expect((await itemsOf(rid))[0].family_name).toBe(newName);
  });

  it('家庭已解散，但调用方拿着旧家庭 id → 存成个人小票，不是外键错误(500)', async () => {
    const creator = await makeUser();
    const familyId = await makeFamily(creator);
    const name = await familyName(familyId);
    await dbApi.dissolveFamily(familyId, creator.id, name);
    const rid = await stamped(creator.id, stale(familyId, name));
    expect(await row('receipts', rid)).toMatchObject({ family_id: null, family_name: null, account_type: 'individual' });
  });

  it('对照: 不开 stampFamilyFromDb 时仍按调用方给的值写(测试/脚本的老用法不变)', async () => {
    const creator = await makeUser();
    const familyId = await makeFamily(creator);
    const rid = await dbApi.saveReceipt(receipt(creator.id, stale(familyId, 'X')), items);
    expect(await row('receipts', rid)).toMatchObject({ family_id: familyId, family_name: 'X' });
  });

  it('并发: 保存小票和"移除成员"同时发生 20 次 → 不论谁先，被移除者名下没有任何还挂着原家庭的小票/明细，也没有报错', async () => {
    for (let i = 0; i < 20; i++) {
      const creator = await makeUser();
      const member = await makeUser();
      const familyId = await makeFamily(creator, member);
      const [removed, saved1, saved2] = await Promise.all([
        dbApi.removeMember(familyId, creator.id, member.id),
        stamped(member.id),
        stamped(member.id),
      ]);
      expect(removed).toBe('removed');
      for (const rid of [saved1, saved2]) {
        expect(await row('receipts', rid)).toMatchObject({ user_id: member.id, family_id: null, family_name: null });
        expect((await itemsOf(rid))[0].family_id).toBeNull();
      }
    }
  });

  it('并发: 保存小票和"解散家庭"同时发生 10 次 → 没有悬空的家庭引用，没有报错', async () => {
    for (let i = 0; i < 10; i++) {
      const creator = await makeUser();
      const familyId = await makeFamily(creator);
      const name = await familyName(familyId);
      const [dissolved, saved] = await Promise.all([dbApi.dissolveFamily(familyId, creator.id, name), stamped(creator.id)]);
      expect(dissolved).toBe('dissolved');
      expect(await row('receipts', saved)).toMatchObject({ family_id: null, family_name: null });
    }
  });

  it('并发: 保存小票和"改名"同时发生 → 小票上的家庭名最终与家庭当前名字一致', async () => {
    for (let i = 0; i < 10; i++) {
      const creator = await makeUser();
      const familyId = await makeFamily(creator);
      const newName = uniq('rn');
      const [renamed, saved] = await Promise.all([dbApi.renameFamily(familyId, creator.id, newName), stamped(creator.id)]);
      expect(renamed).toBe('renamed');
      expect((await row('receipts', saved)).family_name).toBe(newName);
      expect((await itemsOf(saved))[0].family_name).toBe(newName);
    }
  });

  it('走路由: POST /api/receipts 里请求体伪造的 family_id / family_name 被忽略', async () => {
    const creator = await makeUser();
    const other = await makeUser();
    const otherFamily = await makeFamily(other);
    const familyId = await makeFamily(creator);
    await loginAs(creator);
    const res = await receiptsRoute.POST(req('/api/receipts', {
      method: 'POST',
      body: { receipt: { store: 'S', purchased_at: '2026-05-01', currency: 'CAD', subtotal: 1, gst: 0, pst: 0, total: 1, family_id: otherFamily, family_name: 'forged', user_id: other.id }, items },
    }));
    expect(res.status).toBe(200);
    const saved = await row('receipts', (await res.json()).id);
    expect(saved).toMatchObject({ user_id: creator.id, family_id: familyId });
    expect(saved.family_name).not.toBe('forged');
  });
});

describe('createFamily 不覆盖已有的家庭归属', () => {
  it('用户已经在某个家庭里 → 返回 null，原家庭不变，没有留下多余的家庭记录', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const fa = await makeFamily(a, b);
    const before = (await dbApi.pool.query('SELECT COUNT(*) n FROM families'))[0][0].n;
    expect(await dbApi.createFamily(uniq('dup'), b.id)).toBeNull();
    expect((await dbApi.pool.query('SELECT family_id FROM users WHERE id = ?', [b.id]))[0][0].family_id).toBe(fa);
    expect((await dbApi.pool.query('SELECT COUNT(*) n FROM families'))[0][0].n).toBe(before);
  });

  it('路由: 已经在家庭里再创建 → 400', async () => {
    const a = await makeUser();
    await makeFamily(a);
    await loginAs(a);
    expect((await familyRoute.POST(req('/x', { method: 'POST', body: { name: uniq('again') } }))).status).toBe(400);
  });
});

describe('补充: 转让之后原创建者失去全部创建者权限', () => {
  it('原创建者不能再移除成员 / 解散 / 改名；不能再转让', async () => {
    const creator = await makeUser();
    const m1 = await makeUser();
    const m2 = await makeUser();
    const familyId = await makeFamily(creator, m1, m2);
    const name = await familyName(familyId);
    await loginAs(creator);
    expect((await transferRoute.POST(req('/x', { method: 'POST', body: { userId: m1.id } }))).status).toBe(200);
    expect((await memberRoute.DELETE(req('/x', { method: 'DELETE' }), ctx({ id: String(m2.id) }))).status).toBe(403);
    expect((await dissolveRoute.POST(req('/x', { method: 'POST', body: { name } }))).status).toBe(403);
    expect((await familyRoute.PATCH(req('/x', { method: 'PATCH', body: { name: uniq('x') } }))).status).toBe(403);
    expect((await transferRoute.POST(req('/x', { method: 'POST', body: { userId: m2.id } }))).status).toBe(403);
    expect(await familyName(familyId)).toBe(name);
  });

  it('transfer 的 userId 是数字字符串("5")也被拒绝(必须是 number)', async () => {
    const creator = await makeUser();
    const m = await makeUser();
    await makeFamily(creator, m);
    await loginAs(creator);
    expect((await transferRoute.POST(req('/x', { method: 'POST', body: { userId: String(m.id) } }))).status).toBe(400);
  });
});

describe('补充: 并发改名(真正并发，直接调 dbApi.renameFamily)', () => {
  it('两个家庭同时改成同一个新名字 → 恰好一个 renamed，另一个 name_taken，没有异常', async () => {
    for (let i = 0; i < 8; i++) {
      const a = await makeUser();
      const b = await makeUser();
      const fa = await makeFamily(a);
      const fb = await makeFamily(b);
      const target = uniq('clash');
      const results = await Promise.all([dbApi.renameFamily(fa, a.id, target), dbApi.renameFamily(fb, b.id, target)]);
      expect(results.slice().sort()).toEqual(['name_taken', 'renamed']);
    }
  });
});

describe('补充: /uploads 与家庭成员关系变化保持一致', () => {
  const put = (name) => fs.writeFileSync(path.join(process.env.UPLOAD_DIR, name), Buffer.from('img'));
  const get = (name) => uploadsRoute.GET(req('/uploads/' + name), ctx({ file: [name] }));

  it('加入家庭之前的个人小票的原图: 本人能看，同家庭成员看不到', async () => {
    const creator = await makeUser();
    const b = await makeUser();
    const old = uniq('old') + '.jpg';
    put(old);
    await makeReceipt(b, { imageFile: old }); // b 加入前的个人小票(无 family_id)
    await makeFamily(creator, b);
    await loginAs(b);
    expect((await get(old)).status).toBe(200);
    await loginAs(creator);
    expect((await get(old)).status).toBe(404);
  });

  it('成员退出后: 他以家庭身份保存的小票原图，原家庭看不到了，本人仍能看', async () => {
    const creator = await makeUser();
    const member = await makeUser();
    const familyId = await makeFamily(creator, member);
    const img = uniq('fam') + '.jpg';
    put(img);
    await dbApi.saveReceipt(receipt(member.id, { image_file: img, ...stale(familyId, await familyName(familyId)) }), items);
    await loginAs(creator);
    expect((await get(img)).status).toBe(200);
    await loginAs(member);
    await leaveRoute.POST(req('/x', { method: 'POST', body: {} }));
    expect((await get(img)).status).toBe(200);
    await loginAs(creator);
    expect((await get(img)).status).toBe(404);
  });

  it('解散后: 每个人只能看自己的原图', async () => {
    const creator = await makeUser();
    const member = await makeUser();
    const familyId = await makeFamily(creator, member);
    const name = await familyName(familyId);
    const img = uniq('fam') + '.jpg';
    put(img);
    await dbApi.saveReceipt(receipt(member.id, { image_file: img, ...stale(familyId, name) }), items);
    await dbApi.dissolveFamily(familyId, creator.id, name);
    await loginAs(creator);
    expect((await get(img)).status).toBe(404);
    await loginAs(member);
    expect((await get(img)).status).toBe(200);
    logout();
    expect((await get(img)).status).toBe(404);
  });
});
