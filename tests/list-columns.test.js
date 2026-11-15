// H-P1(2026-11-14 优化轮): 列表接口不再带 raw_json(模型原始返回，评估集里每张中位 1.0 KB、最大 3.1 KB，列表界面从不显示)，
// 列表界面用到的每个字段仍然在；详情接口仍然返回 raw_json。
import { describe, it, expect } from 'vitest';
import * as receiptsRoute from '@/app/api/receipts/route.js';
import * as receiptRoute from '@/app/api/receipts/[id]/route.js';
import * as adminReceiptsRoute from '@/app/api/admin/receipts/route.js';
import * as adminReceiptRoute from '@/app/api/admin/receipts/[id]/route.js';
import { makeUser, makeReceipt, loginAs, req, ctx } from './helpers.js';

// components/ReceiptsTab.js 与 components/admin/ReceiptsPanel.js 的列表行用到的字段
const LIST_FIELDS = ['id', 'user_id', 'store', 'purchased_at', 'subtotal', 'gst', 'pst', 'total', 'owner_username', 'item_count'];

describe('列表接口不带 raw_json，详情接口带', () => {
  it('GET /api/receipts: 每行都没有 raw_json，列表界面用到的字段齐全', async () => {
    const u = await makeUser();
    const id = await makeReceipt(u, { total: 12.5 });
    await loginAs(u);
    const rows = await (await receiptsRoute.GET(req('/api/receipts'))).json();
    const row = rows.find((r) => r.id === id);
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty('raw_json');
    for (const f of LIST_FIELDS) expect(row, f).toHaveProperty(f);
    expect(row).toMatchObject({ user_id: u.id, owner_username: u.username, total: 12.5, item_count: 1 });
  });

  it('GET /api/receipts/[id]: 详情仍然返回 raw_json 与明细', async () => {
    const u = await makeUser();
    const id = await makeReceipt(u);
    await loginAs(u);
    const detail = await (await receiptRoute.GET(req('/api/receipts/' + id), ctx({ id: String(id) }))).json();
    expect(detail.raw_json).toBe('{}');
    expect(detail.items).toHaveLength(1);
  });

  it('管理后台: 列表没有 raw_json，详情有', async () => {
    const admin = await makeUser({ admin: true });
    const u = await makeUser();
    const id = await makeReceipt(u);
    await loginAs(admin);
    const rows = await (await adminReceiptsRoute.GET(req('/api/admin/receipts?userId=' + u.id))).json();
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty('raw_json');
    for (const f of LIST_FIELDS) expect(rows[0], f).toHaveProperty(f);
    const detail = await (await adminReceiptRoute.GET(req('/api/admin/receipts/' + id), ctx({ id: String(id) }))).json();
    expect(detail.raw_json).toBe('{}');
  });
});
