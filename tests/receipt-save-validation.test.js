// #22: POST /api/receipts 输入校验——非法输入一律 400(不是 500)，不落库、不落盘
import fs from 'fs';
import { describe, it, expect } from 'vitest';
import dbApi from '@/src/db.cjs';
import * as route from '@/app/api/receipts/route.js';
import { makeUser, loginAs, req } from './helpers.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const good = () => ({
  receipt: { store: 'T&T', purchased_at: '2026-05-01', currency: 'CAD', subtotal: 10, gst: 0.5, pst: 0.7, total: 11.2 },
  items: [{ name_raw: 'Milk', name_norm: 'milk', category: '食品杂货', subcategory: null, qty: 1, unit: null, unit_price: 10, amount: 10, taxable: 1 }],
});
const post = (body) => route.POST(req('/api/receipts', { method: 'POST', body }));
const mut = (fn) => { const b = good(); fn(b); return b; };
const count = async (uid) => (await dbApi.pool.execute('SELECT COUNT(*) c FROM receipts WHERE user_id = :uid', { uid }))[0][0].c;
const files = () => fs.readdirSync(process.env.UPLOAD_DIR).length;

const invalid = {
  '商家 300 字符': (b) => { b.receipt.store = 'x'.repeat(300); },
  '商家为空': (b) => { b.receipt.store = '   '; },
  '商家不是字符串': (b) => { b.receipt.store = 5; },
  '日期 2026-99-99': (b) => { b.receipt.purchased_at = '2026-99-99'; },
  '日期为空串': (b) => { b.receipt.purchased_at = ''; },
  '日期不是字符串': (b) => { b.receipt.purchased_at = 20260501; },
  'total 非数字字符串': (b) => { b.receipt.total = 'abc'; },
  'total 为 null': (b) => { b.receipt.total = null; },
  'total 1e12': (b) => { b.receipt.total = 1e12; },
  'subtotal 缺失': (b) => { delete b.receipt.subtotal; },
  'gst 1e15': (b) => { b.receipt.gst = 1e15; },
  'gst 缺失': (b) => { delete b.receipt.gst; },
  'pst 缺失': (b) => { delete b.receipt.pst; },
  'currency 超长': (b) => { b.receipt.currency = 'CADCADCADCAD'; },
  'currency 不是字符串': (b) => { b.receipt.currency = 1; },
  'receipt 是数组': (b) => { b.receipt = []; },
  'receipt 是字符串': (b) => { b.receipt = 'x'; },
  'items 不是数组': (b) => { b.items = 'x'; },
  'items 为空数组': (b) => { b.items = []; },
  'items 超过 300 条': (b) => { b.items = Array.from({ length: 301 }, () => good().items[0]); },
  'items 含 null': (b) => { b.items.push(null); },
  'qty 是字符串': (b) => { b.items[0].qty = '2'; },
  'amount 1e20': (b) => { b.items[0].amount = 1e20; },
  '品名 5000 字': (b) => { b.items[0].name_raw = 'x'.repeat(5000); },
  'taxable 是 yes': (b) => { b.items[0].taxable = 'yes'; },
  'category 缺失': (b) => { delete b.items[0].category; },
  '单位超长': (b) => { b.items[0].unit = 'u'.repeat(51); },
};

describe('保存小票: 非法输入 → 400，不入库、不落盘', () => {
  for (const [name, fn] of Object.entries(invalid)) {
    it(name, async () => {
      const u = await makeUser();
      await loginAs(u);
      const before = files();
      const b = mut(fn);
      b.image = PNG; // 带图: 也不能留下孤儿图片
      const res = await post(b);
      expect(res.status).toBe(400);
      expect(typeof (await res.json()).error).toBe('string');
      expect(await count(u.id)).toBe(0);
      expect(files()).toBe(before);
    });
  }
});

describe('保存小票: 合法输入', () => {
  it('ScanTab 实际发送的形状(unit/subcategory/name_norm 为 null，unit_price 为 null，带 image 与 raw)→ 200', async () => {
    const u = await makeUser();
    await loginAs(u);
    const b = good();
    b.items = [{ name_raw: '未知商品', name_norm: null, category: '其他', subcategory: null, qty: 0, unit: null, unit_price: null, amount: 3, taxable: 0 }];
    b.receipt.store = '未知';
    b.image = PNG;
    b.raw = { receipt: b.receipt, items: b.items };
    const before = files();
    const res = await post(b);
    expect(res.status).toBe(200);
    expect(files()).toBe(before + 1);
    const [[row]] = await dbApi.pool.execute('SELECT store, subtotal, total, currency FROM receipts WHERE user_id = :uid', { uid: u.id });
    expect(row).toMatchObject({ store: '未知', subtotal: 10, total: 11.2, currency: 'CAD' });
  });

  it('缺 currency/unit/subcategory/name_norm/unit_price 也能保存(取默认)，单价按金额/数量回推', async () => {
    const u = await makeUser();
    await loginAs(u);
    const b = mut((x) => {
      delete x.receipt.currency;
      x.items[0] = { name_raw: 'A', category: '食品杂货', qty: 2, amount: 10, taxable: true };
    });
    expect((await post(b)).status).toBe(200);
    const [[it]] = await dbApi.pool.execute('SELECT i.unit_price, i.unit, r.currency FROM items i JOIN receipts r ON r.id = i.receipt_id WHERE r.user_id = :uid', { uid: u.id });
    expect(it).toMatchObject({ unit_price: 5, unit: null, currency: 'CAD' });
  });

  it('保留客户端确认的 subtotal/total(与明细和不一致，如印刷总额)', async () => {
    const u = await makeUser();
    await loginAs(u);
    const b = mut((x) => { x.receipt.subtotal = 9.99; x.receipt.total = 12.34; });
    expect((await post(b)).status).toBe(200);
    const [[r]] = await dbApi.pool.execute('SELECT subtotal, total FROM receipts WHERE user_id = :uid', { uid: u.id });
    expect(r).toMatchObject({ subtotal: 9.99, total: 12.34 });
  });

  it('白名单外的分类归一为"其他"', async () => {
    const u = await makeUser();
    await loginAs(u);
    expect((await post(mut((x) => { x.items[0].category = 'NOT_IN_LIST'; }))).status).toBe(200);
    const [[it]] = await dbApi.pool.execute('SELECT i.category FROM items i JOIN receipts r ON r.id = i.receipt_id WHERE r.user_id = :uid', { uid: u.id });
    expect(it.category).toBe('其他');
  });

  it('重复小票仍可保存(查重只是提示)', async () => {
    const u = await makeUser();
    await loginAs(u);
    expect((await post(good())).status).toBe(200);
    expect((await post(good())).status).toBe(200);
    expect(await count(u.id)).toBe(2);
  });

  it('负金额(折扣行)可保存', async () => {
    const u = await makeUser();
    await loginAs(u);
    const b = mut((x) => { x.items.push({ ...x.items[0], name_raw: '折扣', amount: -2, unit_price: -2 }); });
    expect((await post(b)).status).toBe(200);
  });
});
