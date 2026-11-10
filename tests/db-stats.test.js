// 迁移自 scripts/selfcheck.cjs 第 2 部分: 入库 + 各项统计 + 按用户隔离
import { describe, it, expect, beforeAll } from 'vitest';
import dbApi from '@/src/db.cjs';
import { makeUser } from './helpers.js';

describe('入库与统计', () => {
  let userId;
  beforeAll(async () => {
    ({ id: userId } = await makeUser());
    const base = { user_id: userId, store: '__TEST_COSTCO', currency: 'CAD', gst: 0, pst: 0, image_file: null, raw_json: '{}' };
    await dbApi.saveReceipt({ ...base, purchased_at: '2026-04-15', subtotal: 30, total: 30 }, [
      { name_raw: 'BEEF', name_norm: '牛肉', category: '肉类', subcategory: '牛肉', qty: 1, unit: 'kg', unit_price: 18, amount: 18, taxable: 0 },
      { name_raw: 'CHICKEN', name_norm: '鸡胸肉', category: '肉类', subcategory: '鸡肉', qty: 1, unit: 'kg', unit_price: 12, amount: 12, taxable: 0 },
    ]);
    await dbApi.saveReceipt({ ...base, purchased_at: '2026-05-20', subtotal: 20, total: 20 }, [
      { name_raw: 'BEEF', name_norm: '牛肉', category: '肉类', subcategory: '牛肉', qty: 1, unit: 'kg', unit_price: 22, amount: 22, taxable: 0 },
    ]);
  });

  it('肉类总花费 = 52 (18+12+22)', async () => {
    const cat = (await dbApi.statsByCategory('2026-01-01', '2026-12-31', { userId })).find((x) => x.label === '肉类');
    expect(cat.amount).toBe(52);
  });

  it('牛肉细分 = 40 (18+22)', async () => {
    const sub = await dbApi.statsBySubcategory('肉类', '2026-01-01', '2026-12-31', { userId });
    expect(sub.find((x) => x.label === '牛肉').amount).toBe(40);
  });

  it('月度按 YYYY-MM 分组', async () => {
    const months = (await dbApi.statsMonthly('2026-01-01', '2026-12-31', { userId })).map((m) => m.month);
    expect(months).toEqual(expect.arrayContaining(['2026-04', '2026-05']));
  });

  it('牛肉价格趋势按时间升序: 18 → 22', async () => {
    const trend = await dbApi.priceTrend('牛肉', '__TEST_COSTCO', { userId });
    expect(trend.map((t) => t.unit_price)).toEqual([18, 22]);
  });

  it('其他用户看不到本账号的数据(按 user_id 隔离)', async () => {
    const other = await makeUser();
    expect(await dbApi.priceTrend('牛肉', '__TEST_COSTCO', { userId: other.id })).toHaveLength(0);
  });

  it('删除用户后小票和明细级联清除', async () => {
    const u = await makeUser();
    await dbApi.saveReceipt({ user_id: u.id, store: '__TEST_CASCADE', purchased_at: '2026-05-01', subtotal: 5, total: 5, gst: 0, pst: 0, currency: 'CAD', image_file: null, raw_json: '{}' },
      [{ name_raw: 'A', name_norm: '级联测试', category: '其他', subcategory: null, qty: 1, unit: null, unit_price: 5, amount: 5, taxable: 0 }]);
    await dbApi.deleteUser(u.id);
    expect(await dbApi.priceTrend('级联测试', '__TEST_CASCADE', { userId: u.id })).toHaveLength(0);
  });
});
