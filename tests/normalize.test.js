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

describe('normalize(): 模型没给出合法日期时仍填今天，但标 date_guessed(H-R2)', () => {
  const base = { store: 'X', currency: 'CAD', subtotal: 10, gst: 0, pst: 0, total: 10, items: [{ name_raw: 'A', category: '其他', amount: 10, taxable: false }] };
  const run = (over) => openrouterLib.normalize({ ...base, ...over }).receipt;
  const today = new Date().toISOString().slice(0, 10);

  it('合法日期 → 原样保留，date_guessed 为 false', () => {
    expect(run({ purchased_at: '2026-05-10' })).toMatchObject({ purchased_at: '2026-05-10', date_guessed: false });
  });
  it('空字符串 → 填今天，date_guessed 为 true', () => {
    expect(run({ purchased_at: '' })).toMatchObject({ purchased_at: today, date_guessed: true });
  });
  it('缺失或不是 YYYY-MM-DD → 填今天，date_guessed 为 true', () => {
    expect(run({})).toMatchObject({ purchased_at: today, date_guessed: true });
    expect(run({ purchased_at: '10/05/2026' })).toMatchObject({ purchased_at: today, date_guessed: true });
    expect(run({ purchased_at: null })).toMatchObject({ purchased_at: today, date_guessed: true });
  });
});

describe('normalize(): 印出的 total 比 subtotal+gst+pst 多出超过 0.02 时加一条"未识别差额(请核对)"明细(H-R1)', () => {
  const dish = { name_raw: 'Dish', category: '餐厅外食', qty: 1, unit_price: 55, amount: 55, taxable: true };
  const base = { store: 'R', purchased_at: '2026-05-10', currency: 'CAD', items: [dish] };
  const run = (over) => openrouterLib.normalize({ ...base, ...over });

  it('餐厅小费形状: subtotal 55、gst 2.75、total 67.25 → 加 9.50 的差额行，subtotal 跟着明细变 64.50，total 不变', () => {
    const { receipt, items } = run({ subtotal: 55, gst: 2.75, pst: 0, total: 67.25 });
    expect(items).toHaveLength(2);
    expect(items[1]).toEqual({
      name_raw: '未识别差额(请核对)', name_norm: null, category: '其他', subcategory: null,
      qty: 1, unit: null, unit_price: 9.5, amount: 9.5, taxable: 0,
    });
    expect(receipt).toMatchObject({ residual_added: true, subtotal: 64.5, gst: 2.75, pst: 0, total: 67.25 });
    expect(+(receipt.subtotal + receipt.gst + receipt.pst).toFixed(2)).toBe(67.25);
  });
  it('差额正好 0.02(舍入) → 不加', () => {
    const { receipt, items } = run({ subtotal: 55, gst: 2.75, pst: 0, total: 57.77 });
    expect(items).toHaveLength(1);
    expect(receipt).toMatchObject({ residual_added: false, subtotal: 55 });
  });
  it('差额 0.03 → 加', () => {
    const { receipt, items } = run({ subtotal: 55, gst: 2.75, pst: 0, total: 57.78 });
    expect(items).toHaveLength(2);
    expect(items[1].amount).toBe(0.03);
    expect(receipt).toMatchObject({ residual_added: true, subtotal: 55.03 });
  });
  it('total 比 subtotal+gst+pst 少(负差额) → 不加、不动', () => {
    const { receipt, items } = run({ subtotal: 55, gst: 2.75, pst: 0, total: 50 });
    expect(items).toHaveLength(1);
    expect(receipt).toMatchObject({ residual_added: false, subtotal: 55, total: 50 });
  });
  it('total 没印出(靠 subtotal+gst+pst 兜底) → 不加', () => {
    const { receipt, items } = run({ subtotal: 55, gst: 2.75, pst: 0, total: 0 });
    expect(items).toHaveLength(1);
    expect(receipt).toMatchObject({ residual_added: false, total: 57.75 });
  });
  it('已经自洽的小票 → 不加', () => {
    const { receipt, items } = run({ subtotal: 55, gst: 2.75, pst: 3.85, total: 61.6 });
    expect(items).toHaveLength(1);
    expect(receipt.residual_added).toBe(false);
  });
  it('合计税规则先跑: gst=pst=0、差额在 12% 内先拆成 5:7，不会被当成差额行', () => {
    const { receipt, items } = run({ subtotal: 100, gst: 0, pst: 0, total: 112 });
    expect(items).toHaveLength(1);
    expect(receipt).toMatchObject({ residual_added: false, gst: 5, pst: 7 });
  });
  it('gst=pst=0 且差额超过 12%(税规则不拆) → 整个差额成为差额行', () => {
    const { receipt, items } = run({ subtotal: 100, gst: 0, pst: 0, total: 120 });
    expect(items).toHaveLength(2);
    expect(items[1].amount).toBe(20);
    expect(receipt).toMatchObject({ residual_added: true, gst: 0, pst: 0, subtotal: 120, total: 120 });
  });
  it('没有任何明细(非小票图) → 不加', () => {
    const { receipt, items } = run({ items: [], subtotal: 0, gst: 0, pst: 0, total: 10 });
    expect(items).toHaveLength(0);
    expect(receipt.residual_added).toBe(false);
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
