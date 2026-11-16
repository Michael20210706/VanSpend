// lib/editDiff.js: 扫描结果快照 vs 保存时的表单，算出"改了哪些字段名"(只有名字，没有值)，以及随保存发出的 meta
import { describe, it, expect } from 'vitest';
import { diffEdits, buildSaveMeta, MAX_EDITED_FIELDS } from '@/lib/editDiff.js';
import receiptInput from '@/src/receiptInput.cjs';

const receipt = (o = {}) => ({ store: 'T&T', purchased_at: '2026-05-01', subtotal: 10, gst: 0.5, pst: 0.7, total: 11.2, ...o });
// 与 ItemsEditor.makeRow 产出的行同形
const row = (id, o = {}) => ({
  _id: id, name_raw: 'Milk', name_norm: 'milk', category: '食品杂货', subcategory: '', qty: 1, unit: '', unit_price: '', amount: 10, taxable: false, ...o,
});
const snap = (rows = [row(1), row(2, { name_raw: 'Egg' })], r) => ({ receipt: receipt(r), rows });

describe('diffEdits', () => {
  it('什么都没改 → []', () => {
    expect(diffEdits(snap(), { receipt: receipt(), rows: [row(1), row(2, { name_raw: 'Egg' })] })).toEqual([]);
  });

  it('改了商家和第二行的金额 → receipt.store, item[1].amount(下标是 AI 结果里的位置)', () => {
    const after = { receipt: receipt({ store: 'Costco' }), rows: [row(1), row(2, { name_raw: 'Egg', amount: '12.5' })] };
    expect(diffEdits(snap(), after)).toEqual(['receipt.store', 'item[1].amount']);
  });

  it('每个可编辑字段改了都报自己的名字', () => {
    const after = {
      receipt: { store: 'A', purchased_at: '2026-05-02', subtotal: '11', gst: '1', pst: '2', total: '14' },
      rows: [row(1, { name_raw: 'a', name_norm: 'b', category: '其他', subcategory: 'c', qty: '2', unit: 'kg', unit_price: '5', amount: '11', taxable: true })],
    };
    expect(diffEdits(snap([row(1)]), after)).toEqual([
      'receipt.store', 'receipt.purchased_at', 'receipt.subtotal', 'receipt.gst', 'receipt.pst', 'receipt.total',
      'item[0].name_raw', 'item[0].name_norm', 'item[0].category', 'item[0].subcategory', 'item[0].qty', 'item[0].unit',
      'item[0].unit_price', 'item[0].amount', 'item[0].taxable',
    ]);
  });

  it('删掉第一行、再加一行 → item[-], item[+]；留下的第二行仍按原下标 item[1] 比较', () => {
    const after = { receipt: receipt(), rows: [row(2, { name_raw: 'Egg', taxable: true }), row(9, { name_raw: 'New' })] };
    expect(diffEdits(snap(), after)).toEqual(['item[1].taxable', 'item[-]', 'item[+]']);
  });

  it('删掉两行记两个 item[-]', () => {
    expect(diffEdits(snap(), { receipt: receipt(), rows: [] })).toEqual(['item[-]', 'item[-]']);
  });

  it('保存出去的值相同就不算改: 数字字符串 vs 数字、首尾空格、AI 没给(null)vs 表单里的空串或 0、清空数字框 vs 0', () => {
    const before = {
      receipt: { store: null, purchased_at: '2026-05-01', subtotal: null, gst: 0, pst: undefined, total: 11.2 },
      rows: [row(1, { unit_price: '', subcategory: '', qty: 2, amount: 0 })],
    };
    const after = {
      receipt: { store: '  ', purchased_at: '2026-05-01', subtotal: 0, gst: '', pst: 0, total: '11.20' },
      rows: [row(1, { unit_price: '', subcategory: ' ', qty: '2.0', amount: '' })],
    };
    expect(diffEdits(before, after)).toEqual([]);
  });

  it('单价从空填成 0 是改动(空 = 没有单价，0 = 单价为 0)', () => {
    const after = { receipt: receipt(), rows: [row(1, { unit_price: '0' })] };
    expect(diffEdits(snap([row(1)]), after)).toEqual(['item[0].unit_price']);
  });

  it('输出只有字段名，不含任何值', () => {
    const after = { receipt: receipt({ store: 'SENTINEL_STORE' }), rows: [row(1, { name_raw: 'SENTINEL_ITEM', amount: 777.77 })] };
    const out = diffEdits(snap([row(1)]), after);
    expect(out).toEqual(['receipt.store', 'item[0].name_raw', 'item[0].amount']);
    expect(JSON.stringify(out)).not.toMatch(/SENTINEL|777/);
  });

  it('最多 MAX_EDITED_FIELDS 个，和服务端校验的上限一致，且每个名字都能通过服务端校验', () => {
    expect(MAX_EDITED_FIELDS).toBe(receiptInput.MAX_EDITED_FIELDS);
    const rows = Array.from({ length: 300 }, (_, i) => row(i + 1));
    const edited = rows.map((r) => ({ ...r, name_raw: 'x', amount: 1, qty: 3, unit: 'kg', name_norm: 'y', subcategory: 'z', category: '其他', unit_price: 1, taxable: true }));
    const full = { receipt: receipt({ store: 'a', gst: 1, pst: 1, total: 1, subtotal: 1, purchased_at: '2026-01-01' }), rows: edited };
    const out = diffEdits({ receipt: receipt(), rows }, full);
    expect(out.length).toBe(MAX_EDITED_FIELDS);
    expect(receiptInput.validateSaveMeta({ editedFields: out }).error).toBeUndefined();
    const lastOnly = diffEdits({ receipt: receipt(), rows }, { receipt: receipt(), rows: [...rows.slice(0, 299), edited[299]] });
    expect(lastOnly).toContain('item[299].subcategory');
    expect(receiptInput.validateSaveMeta({ editedFields: lastOnly }).error).toBeUndefined();
  });

  it('AI 结果超过 1000 行时，下标 ≥ 1000 的行不报字段改动(服务端只认 3 位下标)，产出的名字仍全部合法', () => {
    const rows = Array.from({ length: 1002 }, (_, i) => row(i + 1));
    const after = { receipt: receipt(), rows: rows.slice(999).map((r) => ({ ...r, amount: 5 })) };
    const out = diffEdits({ receipt: receipt(), rows }, after);
    expect(out.filter((n) => n !== 'item[-]')).toEqual(['item[999].amount']);
    expect(out.filter((n) => n === 'item[-]')).toHaveLength(999);
    expect(receiptInput.validateSaveMeta({ editedFields: out }).error).toBeUndefined();
  });
});

describe('buildSaveMeta', () => {
  const snapshot = (o = {}) => ({ scanId: 42, at: 1_000_000, ...snap(), ...o });
  const form = { receipt: receipt({ gst: '0.6' }), rows: [row(1), row(2, { name_raw: 'Egg' }), row(7)] };

  it('没有快照(这次保存不是从一次识别来的)→ undefined，请求里就没有 meta', () => {
    expect(buildSaveMeta(null, form, 1)).toBeUndefined();
    expect(JSON.parse(JSON.stringify({ meta: buildSaveMeta(null, form, 1) }))).toEqual({});
  });

  it('字段名、AI 条数、识别完成到点保存的毫秒数、scanId；能通过服务端校验', () => {
    const meta = buildSaveMeta(snapshot(), form, 1_004_321);
    expect(meta).toEqual({ scanId: 42, editedFields: ['receipt.gst', 'item[+]'], itemsAi: 2, scanToSaveMs: 4321 });
    expect(receiptInput.validateSaveMeta(JSON.parse(JSON.stringify(meta)))).toEqual({ meta });
  });

  it('识别响应里没有 scanId → 发出去的 meta 没有这个键，服务端当作没有对应的扫描', () => {
    const sent = JSON.parse(JSON.stringify(buildSaveMeta(snapshot({ scanId: undefined }), form, 1_000_010)));
    expect(sent).toEqual({ editedFields: ['receipt.gst', 'item[+]'], itemsAi: 2, scanToSaveMs: 10 });
    expect(receiptInput.validateSaveMeta(sent).meta.scanId).toBeNull();
  });

  it('毫秒数夹在 0 和 INT 上限之间: 时钟回拨不出负数，页面开了一个月也不会让保存被 400', () => {
    expect(buildSaveMeta(snapshot(), form, 999_000).scanToSaveMs).toBe(0);
    const month = buildSaveMeta(snapshot(), form, 1_000_000 + 40 * 86400e3);
    expect(month.scanToSaveMs).toBe(2147483647);
    expect(receiptInput.validateSaveMeta(month).error).toBeUndefined();
  });
});
