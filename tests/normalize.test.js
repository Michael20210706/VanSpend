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
