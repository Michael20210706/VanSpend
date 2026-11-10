// [id] 路由段只接受纯数字: '1abc' / 'abc' / '0' 之类一律 400，不能变成 NaN 绑进 SQL 再得到 500 或误匹配
import { describe, it, expect } from 'vitest';
import * as receiptRoute from '@/app/api/receipts/[id]/route.js';
import * as adminReceiptRoute from '@/app/api/admin/receipts/[id]/route.js';
import * as decideRoute from '@/app/api/family/requests/[id]/route.js';
import { parseId } from '@/src/http';
import { makeUser, makeFamily, makeReceipt, loginAs, req, ctx } from './helpers.js';

const BAD = ['abc', '1abc', '0', '-1', '1.5', '', ' 1', '1e3', '9'.repeat(30)];

describe('parseId()', () => {
  it('纯数字 → 数字；其余 → null', () => {
    expect(parseId('42')).toBe(42);
    expect(parseId('007')).toBe(7);
    for (const bad of BAD) expect(parseId(bad)).toBeNull();
    expect(parseId(undefined)).toBeNull();
    expect(parseId(null)).toBeNull();
  });
});

describe('各 [id] 路由对非法 id 返回 400', () => {
  it('小票详情 / 删除', async () => {
    await loginAs(await makeUser());
    for (const id of BAD) {
      expect((await receiptRoute.GET(req('/x'), ctx({ id }))).status).toBe(400);
      expect((await receiptRoute.DELETE(req('/x', { method: 'DELETE' }), ctx({ id }))).status).toBe(400);
    }
  });

  it('合法 id 的老行为不变: 自己的小票 200，不存在 404，删别人的不会删掉', async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const rid = await makeReceipt(owner);
    await loginAs(owner);
    expect((await receiptRoute.GET(req('/x'), ctx({ id: String(rid) }))).status).toBe(200);
    expect((await receiptRoute.GET(req('/x'), ctx({ id: '99999999' }))).status).toBe(404);
    await loginAs(other);
    const res = await receiptRoute.DELETE(req('/x', { method: 'DELETE' }), ctx({ id: String(rid) }));
    expect((await res.json()).deleted).toBe(0);
  });

  it('管理员小票详情 / 删除', async () => {
    await loginAs(await makeUser({ admin: true }));
    for (const id of BAD) {
      expect((await adminReceiptRoute.GET(req('/x'), ctx({ id }))).status).toBe(400);
      expect((await adminReceiptRoute.DELETE(req('/x', { method: 'DELETE' }), ctx({ id }))).status).toBe(400);
    }
  });

  it('家庭创建者审核申请', async () => {
    const creator = await makeUser();
    await makeFamily(creator);
    await loginAs(creator);
    for (const id of BAD) {
      const res = await decideRoute.POST(req('/x', { method: 'POST', body: { decision: 'approve' } }), ctx({ id }));
      expect(res.status).toBe(400);
    }
    // 合法但不存在的申请 id 仍是 404
    const res = await decideRoute.POST(req('/x', { method: 'POST', body: { decision: 'approve' } }), ctx({ id: '99999999' }));
    expect(res.status).toBe(404);
  });
});
