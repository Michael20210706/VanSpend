// P2 / 决定: 创建或加入家庭前记的个人小票(没有家庭归属)保持私有——本人在列表/详情/统计里仍然看得到，
// 但不会共享给家庭成员。(此前的 bug: 创建/加入家庭后，这些旧小票会从本人的视图里消失)
import { describe, it, expect } from 'vitest';
import dbApi from '@/src/db.cjs';
import * as receiptsRoute from '@/app/api/receipts/route.js';
import * as receiptRoute from '@/app/api/receipts/[id]/route.js';
import * as overviewRoute from '@/app/api/stats/overview/route.js';
import * as categoryRoute from '@/app/api/stats/category/route.js';
import * as trendRoute from '@/app/api/stats/trend/route.js';
import * as namesRoute from '@/app/api/items/names/route.js';
import * as inviteRoute from '@/app/api/family/invite/route.js';
import * as decideRoute from '@/app/api/family/requests/[id]/route.js';
import * as applyRoute from '@/app/api/family/apply/route.js';
import { makeUser, makeFamily, makeReceipt, loginAs, req, ctx } from './helpers.js';

const ids = async () => (await (await receiptsRoute.GET(req('/api/receipts'))).json()).map((r) => r.id);
const detail = (id) => receiptRoute.GET(req('/x'), ctx({ id: String(id) }));
const overview = async () => (await overviewRoute.GET(req('/api/stats/overview'))).json();

// 带名字的个人小票(便于测趋势/品名)
async function personal(user, { total = 10, norm = '牛奶' } = {}) {
  return dbApi.saveReceipt(
    { user_id: user.id, store: '__VIS', purchased_at: '2026-05-01', currency: 'CAD', subtotal: total, gst: 0, pst: 0, total, image_file: null, raw_json: '{}' },
    [{ name_raw: norm, name_norm: norm, category: '乳制品蛋类', subcategory: null, qty: 1, unit: null, unit_price: total, amount: total, taxable: 0 }]
  );
}

describe('加入家庭之前的个人小票保持私有，但本人仍可见', () => {
  it('创建家庭后: 创建者仍看到自己的旧小票(列表 + 详情 + 统计)', async () => {
    const creator = await makeUser();
    const old = await personal(creator, { total: 25 });
    const familyId = await makeFamily(creator); // 创建家庭
    await loginAs(creator);
    expect(await ids()).toContain(old);
    expect((await detail(old)).status).toBe(200);
    expect((await overview()).total).toBe(25);
    expect(familyId).toBeGreaterThan(0);
  });

  it('成员 B 加入后: B 的旧小票只有 B 自己看得到，创建者看不到', async () => {
    const creator = await makeUser();
    const b = await makeUser();
    const bOld = await personal(b, { total: 40 });
    const cOld = await personal(creator, { total: 5 });
    await makeFamily(creator, b);
    await loginAs(creator);
    expect(await ids()).toContain(cOld);
    expect(await ids()).not.toContain(bOld);
    expect((await detail(bOld)).status).toBe(404);
    expect((await overview()).total).toBe(5);
    await loginAs(b);
    expect(await ids()).toContain(bOld);
    expect(await ids()).not.toContain(cOld);
    expect((await detail(cOld)).status).toBe(404);
    expect((await overview()).total).toBe(40);
  });

  it('加入之后以家庭身份保存的小票双方都看得到，统计里是 旧(自己的) + 家庭的', async () => {
    const creator = await makeUser();
    const b = await makeUser();
    const bOld = await personal(b, { total: 40 });
    const familyId = await makeFamily(creator, b);
    const shared = await makeReceipt(creator, { familyId, total: 7 });
    await loginAs(b);
    expect(new Set(await ids())).toEqual(new Set([bOld, shared]));
    expect((await overview()).total).toBe(47);
    await loginAs(creator);
    expect(await ids()).toEqual([shared]);
    expect((await overview()).total).toBe(7);
  });

  it('分类统计 / 价格趋势 / 品名候选同样包含本人旧小票、不含别人的旧小票', async () => {
    const creator = await makeUser();
    const b = await makeUser();
    await personal(b, { total: 40, norm: 'B的旧品' });
    await personal(creator, { total: 5, norm: 'C的旧品' });
    await makeFamily(creator, b);
    await loginAs(b);
    const cat = await (await categoryRoute.GET(req('/api/stats/category'))).json();
    expect(cat.find((c) => c.label === '乳制品蛋类').amount).toBe(40);
    const names = (await (await namesRoute.GET(req('/api/items/names'))).json()).map((x) => x.name);
    expect(names).toContain('B的旧品');
    expect(names).not.toContain('C的旧品');
    const trend = await (await trendRoute.GET(req('/api/stats/trend?name=' + encodeURIComponent('B的旧品')))).json();
    expect(trend.map((t) => t.unit_price)).toEqual([40]);
    const other = await (await trendRoute.GET(req('/api/stats/trend?name=' + encodeURIComponent('C的旧品')))).json();
    expect(other).toEqual([]);
  });

  it('通过邀请(按用户名)和审批加入，旧小票同样保持私有且本人可见', async () => {
    const creator = await makeUser();
    await makeFamily(creator);
    const invited = await makeUser();
    const applicant = await makeUser();
    const iOld = await personal(invited);
    const aOld = await personal(applicant);
    await loginAs(creator);
    await inviteRoute.POST(req('/x', { method: 'POST', body: { username: invited.username } }));
    await loginAs(applicant);
    const name = (await dbApi.pool.query('SELECT f.name FROM families f JOIN users u ON u.family_id = f.id WHERE u.id = ?', [creator.id]))[0][0].name;
    await applyRoute.POST(req('/x', { method: 'POST', body: { name } }));
    const [[{ id: reqId }]] = await dbApi.pool.query('SELECT id FROM family_join_requests WHERE user_id = ?', [applicant.id]);
    await loginAs(creator);
    await decideRoute.POST(req('/x', { method: 'POST', body: { decision: 'approve' } }), ctx({ id: String(reqId) }));
    await loginAs(invited);
    expect(await ids()).toEqual([iOld]);
    await loginAs(applicant);
    expect(await ids()).toEqual([aOld]);
    await loginAs(creator);
    expect(await ids()).not.toContain(iOld);
    expect(await ids()).not.toContain(aOld);
  });

  it('删除仍然只有本人: 家庭成员不能删别人以家庭身份保存的小票', async () => {
    const creator = await makeUser();
    const b = await makeUser();
    const familyId = await makeFamily(creator, b);
    const r = await makeReceipt(creator, { familyId });
    await loginAs(b);
    const res = await (await import('@/app/api/receipts/[id]/route.js')).DELETE(req('/x', { method: 'DELETE' }), ctx({ id: String(r) }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('未找到');
    expect((await dbApi.pool.query('SELECT id FROM receipts WHERE id = ?', [r]))[0]).toHaveLength(1);
    await loginAs(creator);
    const own = await (await import('@/app/api/receipts/[id]/route.js')).DELETE(req('/x', { method: 'DELETE' }), ctx({ id: String(r) }));
    expect(own.status).toBe(200);
    expect((await own.json()).deleted).toBe(1);
  });

  it('无家庭用户的行为不变: 只看自己的', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const ar = await personal(a);
    await personal(b);
    await loginAs(a);
    expect(await ids()).toEqual([ar]);
  });
});
