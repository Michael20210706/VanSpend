// 识别阶段的提示标记(date_guessed / residual_added)只存在于 /api/scan 的返回里，保存与编辑接口都把它们当作未知字段忽略，不入库也不 400
import { describe, it, expect } from 'vitest';
import dbApi from '@/src/db.cjs';
import receiptInput from '@/src/receiptInput.cjs';
import * as receiptsRoute from '@/app/api/receipts/route.js';
import * as receiptRoute from '@/app/api/receipts/[id]/route.js';
import { makeUser, loginAs, req, ctx } from './helpers.js';

const item = (o = {}) => ({
  name_raw: 'Milk', name_norm: '牛奶', category: '乳制品蛋类', subcategory: null,
  qty: 1, unit: null, unit_price: 6, amount: 6, taxable: 0, ...o,
});
const flagged = {
  store: 'Costco', purchased_at: '2026-06-01', currency: 'CAD', subtotal: 15.5, gst: 0.5, pst: 0.7, total: 16.7,
  date_guessed: true, residual_added: true,
};
const residual = item({ name_raw: '未识别差额(请核对)', name_norm: null, category: '其他', unit_price: 9.5, amount: 9.5 });

describe('validateSave / validateEdit 去掉识别标记', () => {
  it('返回的 receipt 里没有 date_guessed / residual_added', () => {
    const s = receiptInput.validateSave({ receipt: flagged, items: [item(), residual] }, 'CAD');
    expect(s.error).toBeUndefined();
    expect(s.receipt).not.toHaveProperty('date_guessed');
    expect(s.receipt).not.toHaveProperty('residual_added');
    const e = receiptInput.validateEdit({ receipt: flagged, items: [item(), residual] }, 'CAD');
    expect(e.error).toBeUndefined();
    expect(e.receipt).not.toHaveProperty('date_guessed');
    expect(e.receipt).not.toHaveProperty('residual_added');
  });
  it('差额行作为普通明细通过校验', () => {
    const s = receiptInput.validateSave({ receipt: flagged, items: [residual] }, 'CAD');
    expect(s.error).toBeUndefined();
    expect(s.items[0]).toMatchObject({ name_raw: '未识别差额(请核对)', category: '其他', amount: 9.5, taxable: 0, qty: 1 });
  });
});

describe('POST /api/receipts 带识别标记', () => {
  it('保存成功(不 400)，库里没有多存任何东西，差额行按普通明细存', async () => {
    const u = await makeUser();
    await loginAs(u);
    const raw = { store: 'Costco', purchased_at: '', items: [] };
    const res = await receiptsRoute.POST(req('/api/receipts', { method: 'POST', body: { receipt: flagged, items: [item(), residual], raw } }));
    expect(res.status).toBe(200);
    const { id } = await res.json();

    const [rows] = await dbApi.pool.execute('SELECT * FROM receipts WHERE id = :id', { id });
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0])).not.toContain('date_guessed');
    expect(Object.keys(rows[0])).not.toContain('residual_added');
    expect(rows[0].raw_json).not.toMatch(/date_guessed|residual_added/);
    expect(rows[0].purchased_at).toBe('2026-06-01');
    expect(Number(rows[0].subtotal)).toBe(15.5);

    const detail = await (await receiptRoute.GET(req('/x'), ctx({ id: String(id) }))).json();
    expect(detail).not.toHaveProperty('date_guessed');
    expect(detail).not.toHaveProperty('residual_added');
    expect(detail.items.map((i) => i.name_raw)).toEqual(['Milk', '未识别差额(请核对)']);
    expect(detail.items[1]).toMatchObject({ category: '其他', taxable: 0 });
    expect(Number(detail.items[1].amount)).toBe(9.5);
  });
});
