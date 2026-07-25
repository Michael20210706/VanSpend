'use strict';
// 离线自检: 不调用 OpenRouter，只验证 normalize 解析、入库、各项统计逻辑是否正确。
// 用法: node scripts/selfcheck.cjs   (会写入 .env 配置的 MySQL 库，需提前在 .env 填好连接信息)

const assert = require('assert');
const { normalize } = require('../src/openrouter.cjs');

let pass = 0;
const ok = (cond, name) => { assert.ok(cond, name); console.log('  ✓', name); pass++; };

async function main() {
  // ---- 1. normalize: 缺失字段兜底 ----
  const sample = {
    store: 'Costco', purchased_at: '2026-05-10', currency: 'CAD',
    subtotal: 0, gst: 1.20, pst: 0, total: 0,
    items: [
      { name_raw: 'BEEF SIRLOIN', name_norm: '牛肉西冷', category: '肉类', subcategory: '牛肉', qty: 2, unit: 'kg', unit_price: 0, amount: 24.00, taxable: false },
      { name_raw: 'COKE 24PK', category: '零食饮料', subcategory: '汽水', qty: 1, amount: 12.00, taxable: true },
      { name_raw: 'WEIRD CAT', category: '不存在的分类', amount: 5, taxable: false }
    ]
  };
  const { receipt, items } = normalize(sample);
  ok(receipt.subtotal === 41.00, 'subtotal 由明细求和兜底 = 41.00');
  ok(receipt.total === 42.20, 'total = subtotal + gst + pst = 42.20');
  ok(items[0].unit_price === 12, '缺失单价由 amount/qty 回推 = 12');
  ok(items[2].category === '其他', '非法分类回落到 其他');
  ok(items[1].taxable === 1 && items[0].taxable === 0, 'taxable 布尔转 0/1');

  // ---- 2. 入库 + 统计 ----
  // 写入 .env 指向的 MySQL 库。自检结束后清掉本次插入(含测试账号)。
  const dbApi = require('../src/db.cjs');

  const TEST_USER = '__test_selfcheck__';
  // findUserByUsername 内部会先 await 建表/迁移完成，避免和 initSchema() 出现竞态
  const leftover = await dbApi.findUserByUsername(TEST_USER);
  if (leftover) await dbApi.pool.query('DELETE FROM users WHERE id = :id', { id: leftover.id }); // 清掉上次异常退出留下的脏数据
  const userId = await dbApi.createUser(TEST_USER, 'not-a-real-hash');

  await dbApi.saveReceipt(
    { user_id: userId, store: '__TEST_COSTCO', purchased_at: '2026-04-15', currency: 'CAD', subtotal: 30, gst: 0, pst: 0, total: 30, image_file: null, raw_json: '{}' },
    [
      { receipt_id: 0, name_raw: 'BEEF', name_norm: '牛肉', category: '肉类', subcategory: '牛肉', qty: 1, unit: 'kg', unit_price: 18, amount: 18, taxable: 0 },
      { receipt_id: 0, name_raw: 'CHICKEN', name_norm: '鸡胸肉', category: '肉类', subcategory: '鸡肉', qty: 1, unit: 'kg', unit_price: 12, amount: 12, taxable: 0 }
    ]
  );
  await dbApi.saveReceipt(
    { user_id: userId, store: '__TEST_COSTCO', purchased_at: '2026-05-20', currency: 'CAD', subtotal: 20, gst: 0, pst: 0, total: 20, image_file: null, raw_json: '{}' },
    [ { receipt_id: 0, name_raw: 'BEEF', name_norm: '牛肉', category: '肉类', subcategory: '牛肉', qty: 1, unit: 'kg', unit_price: 22, amount: 22, taxable: 0 } ]
  );

  const cat = (await dbApi.statsByCategory('2026-01-01', '2026-12-31', { userId })).find(x => x.label === '肉类');
  ok(cat && cat.amount === 52, '肉类总花费 = 52 (18+12+22)');

  const sub = await dbApi.statsBySubcategory('肉类', '2026-01-01', '2026-12-31', { userId });
  const beef = sub.find(x => x.label === '牛肉');
  ok(beef && beef.amount === 40, '牛肉细分 = 40 (18+22)');

  const mon = await dbApi.statsMonthly('2026-01-01', '2026-12-31', { userId });
  ok(mon.some(m => m.month === '2026-04') && mon.some(m => m.month === '2026-05'), '月度按 YYYY-MM 分组');

  const trend = await dbApi.priceTrend('牛肉', '__TEST_COSTCO', { userId });
  ok(trend.length === 2 && trend[0].unit_price === 18 && trend[1].unit_price === 22, '牛肉价格趋势按时间升序: 18 → 22');

  const otherUserTrend = await dbApi.priceTrend('牛肉', '__TEST_COSTCO', { userId: userId + 1 });
  ok(otherUserTrend.length === 0, '其他用户看不到本账号的数据(按 user_id 隔离)');

  // ---- 清理本次测试数据: 删除测试账号，receipts/items 通过外键级联清掉 ----
  await dbApi.pool.query('DELETE FROM users WHERE id = :id', { id: userId });
  ok((await dbApi.priceTrend('牛肉', '__TEST_COSTCO', { userId })).length === 0, '测试数据已清理');

  console.log(`\n全部 ${pass} 项自检通过 ✓`);
  await dbApi.pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
