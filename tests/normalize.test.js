// 迁移自 scripts/selfcheck.cjs 第 1 部分: normalize() 的兜底与校验，不调用 OpenRouter
import { describe, it, expect } from 'vitest';
import openrouterLib from '@/src/openrouter.cjs';

describe('normalize()', () => {
  const { receipt, items } = openrouterLib.normalize({
    store: 'Costco', purchased_at: '2026-05-10', currency: 'CAD',
    subtotal: 0, gst: 1.20, pst: 0, total: 0,
    items: [
      { name_raw: 'BEEF SIRLOIN', name_norm: '牛肉西冷', category: '肉类', subcategory: '牛肉', qty: 2, unit: 'kg', unit_price: 0, amount: 24.00, taxable: false },
      { name_raw: 'COKE 24PK', category: '零食饮料', subcategory: '汽水', qty: 1, amount: 12.00, taxable: true },
      { name_raw: 'WEIRD CAT', category: '不存在的分类', amount: 5, taxable: false },
    ],
  });

  it('subtotal 由明细求和兜底 = 41.00', () => expect(receipt.subtotal).toBe(41));
  it('total = subtotal + gst + pst = 42.20', () => expect(receipt.total).toBe(42.2));
  it('缺失单价由 amount/qty 回推 = 12', () => expect(items[0].unit_price).toBe(12));
  it('非法分类回落到 其他', () => expect(items[2].category).toBe('其他'));
  it('taxable 布尔转 0/1', () => {
    expect(items[1].taxable).toBe(1);
    expect(items[0].taxable).toBe(0);
  });
});

describe('normalize(): 只印一行合计税时按 5:7 拆分(issue #28)', () => {
  const base = { store: 'T&T', purchased_at: '2026-05-10', currency: 'CAD', items: [{ name_raw: 'X', category: '其他', amount: 100, taxable: true }] };
  const run = (over) => openrouterLib.normalize({ ...base, ...over }).receipt;

  it('gst=pst=0 且 total 比 subtotal 多 12.00(正好 12%) → gst 5.00、pst 7.00', () => {
    const r = run({ subtotal: 100, gst: 0, pst: 0, total: 112 });
    expect([r.gst, r.pst]).toEqual([5, 7]);
    expect(r.subtotal + r.gst + r.pst).toBeCloseTo(r.total, 2);
  });
  it('差额不能被 12 整除时，gst 取整到分，pst = 差额 - gst，两者相加仍等于差额', () => {
    const r = run({ subtotal: 50, gst: 0, pst: 0, total: 55.5 });
    expect(r.gst).toBe(2.29);
    expect(+(r.gst + r.pst).toFixed(2)).toBe(5.5);
  });
  it('只有 gst 或 pst 一个不为 0 → 不动', () => {
    expect(run({ subtotal: 100, gst: 5, pst: 0, total: 112 })).toMatchObject({ gst: 5, pst: 0 });
    expect(run({ subtotal: 100, gst: 0, pst: 7, total: 112 })).toMatchObject({ gst: 0, pst: 7 });
  });
  it('差额超过 subtotal 的 12%(更像小费或漏读) → 不拆，保持 0/0', () => {
    expect(run({ subtotal: 100, gst: 0, pst: 0, total: 120 })).toMatchObject({ gst: 0, pst: 0 });
  });
  it('total 不大于 subtotal(税确实为 0) → 不拆', () => {
    expect(run({ subtotal: 100, gst: 0, pst: 0, total: 100 })).toMatchObject({ gst: 0, pst: 0 });
    expect(run({ subtotal: 100, gst: 0, pst: 0, total: 99 })).toMatchObject({ gst: 0, pst: 0 });
  });
  it('total 缺失(靠 subtotal+gst+pst 兜底) → 不会凭空拆分', () => {
    expect(run({ subtotal: 100, gst: 0, pst: 0, total: 0 })).toMatchObject({ gst: 0, pst: 0, total: 100 });
  });
});

describe('normalize(): 模型把整笔合计税填进 pst、gst 留 0 时按 5:7 拆分(issue #28, tnt-01 形状)', () => {
  const base = { store: 'T&T', purchased_at: '2026-05-10', currency: 'CAD', items: [{ name_raw: 'X', category: '其他', amount: 100, taxable: true }] };
  const run = (over) => openrouterLib.normalize({ ...base, ...over }).receipt;

  it('gst=0、pst=2.93、total=subtotal+pst → gst 1.22、pst 1.71', () => {
    const r = run({ subtotal: 41.25, gst: 0, pst: 2.93, total: 44.18 });
    expect([r.gst, r.pst]).toEqual([1.22, 1.71]);
    expect(+(r.gst + r.pst).toFixed(2)).toBe(2.93);
  });
  it('pst 正好是 12% → 5.00 / 7.00', () => {
    const r = run({ subtotal: 100, gst: 0, pst: 12, total: 112 });
    expect([r.gst, r.pst]).toEqual([5, 7]);
  });
  it('total 与 subtotal+pst 差 0.02 以内仍拆(舍入容差)', () => {
    const r = run({ subtotal: 100, gst: 0, pst: 12, total: 112.02 });
    expect([r.gst, r.pst]).toEqual([5, 7]);
  });
  it('gst 不为 0(两个税都印了) → 不动', () => {
    expect(run({ subtotal: 100, gst: 5, pst: 7, total: 112 })).toMatchObject({ gst: 5, pst: 7 });
    expect(run({ subtotal: 100, gst: 0.01, pst: 11.99, total: 112 })).toMatchObject({ gst: 0.01, pst: 11.99 });
  });
  it('pst 超过 subtotal 的 12% → 不动', () => {
    expect(run({ subtotal: 100, gst: 0, pst: 15, total: 115 })).toMatchObject({ gst: 0, pst: 15 });
  });
  it('total 缺失 → 不动', () => {
    expect(run({ subtotal: 100, gst: 0, pst: 7, total: 0 })).toMatchObject({ gst: 0, pst: 7, total: 107 });
  });
  it('total 与 subtotal+pst 对不上(差 0.03 以上，如漏了小费) → 不动', () => {
    expect(run({ subtotal: 100, gst: 0, pst: 7, total: 112 })).toMatchObject({ gst: 0, pst: 7 });
    expect(run({ subtotal: 100, gst: 0, pst: 7, total: 107.03 })).toMatchObject({ gst: 0, pst: 7 });
  });
});
