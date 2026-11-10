// 保存后编辑小票时的请求体校验 + 重算。
// 与 openrouter.cjs 的 normalize() 不同: normalize 面向 AI 的"可能不规范"输出，会悄悄兜底(日期不合法就用今天等)；
// 这里的输入来自用户的明确编辑，不合法就报 400，不替用户改。合法之后再交给 normalize() 做统一规整，
// 并把 subtotal/total 置 0 让它按明细重算: 小计 = 明细金额之和，总额 = 小计 + GST + PST。
const { normalize } = require('./openrouter.cjs');

const MAX_ITEMS = 300;
// 对应 DECIMAL 列的上限(留余量): receipts 金额 DECIMAL(10,2)、items.qty DECIMAL(10,3)、items.unit_price DECIMAL(10,4)
const MAX_MONEY = 99999999;
const MAX_QTY = 9999999;
const MAX_UNIT_PRICE = 999999;

const isNum = (v, max) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max;
const isStr = (v, max) => typeof v === 'string' && v.length <= max;

// 真实存在的日期，年份 1000–9999(MySQL DATE 虽然接受 0000，但那只会是误输入)
function realDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s) || s < '1000-01-01') return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// 金额按 2 位小数取整后再求和: 数据库列是 DECIMAL(x,2)，不先取整的话，小计/总额(按未取整的值求和)
// 会和落库后各行金额之和对不上
const cents = (v) => Math.round(v * 100) / 100;
const hasNul = (v) => typeof v === 'string' && v.includes('\u0000');
const MAX_DERIVED_UNIT_PRICE = 999999.9999; // DECIMAL(10,4)

// 返回 { error } 或 { receipt, items }(receipt 里没有 currency，由调用方沿用原值)
function validateEdit(body, currency) {
  const r = body && body.receipt;
  const items = body && body.items;
  if (!r || typeof r !== 'object' || Array.isArray(r) || !Array.isArray(items)) return { error: '数据格式错误' };
  if (typeof r.store !== 'string' || !r.store.trim() || r.store.length > 255 || hasNul(r.store)) return { error: '商家不能为空，且不能超过 255 个字符' };
  if (!realDate(r.purchased_at)) return { error: '日期格式应为 YYYY-MM-DD' };
  if (!isNum(r.gst, MAX_MONEY) || !isNum(r.pst, MAX_MONEY)) return { error: 'GST/PST 必须是数字' };
  if (items.length < 1) return { error: '至少保留一条明细' };
  if (items.length > MAX_ITEMS) return { error: `明细最多 ${MAX_ITEMS} 条` };
  for (const it of items) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) return { error: '明细格式错误' };
    if (typeof it.name_raw !== 'string' || !it.name_raw.trim() || it.name_raw.length > 255 || hasNul(it.name_raw)) return { error: '品名不能为空，且不能超过 255 个字符' };
    if (it.name_norm != null && !isStr(it.name_norm, 255)) return { error: '规范品名过长' };
    if (it.subcategory != null && !isStr(it.subcategory, 100)) return { error: '细分过长' };
    if (it.unit != null && !isStr(it.unit, 50)) return { error: '单位过长' };
    if (typeof it.category !== 'string') return { error: '分类格式错误' };
    if (!isNum(it.qty, MAX_QTY)) return { error: '数量必须是数字' };
    // 数据库只存到 3 位小数: 比 0.001 还小(但不是 0)的数量会被存成 0，还会让回推的单价爆表
    if (it.qty !== 0 && Math.abs(it.qty) < 0.001) return { error: '数量不能小于 0.001(没有数量请填 0)' };
    if (it.unit_price != null && !isNum(it.unit_price, MAX_UNIT_PRICE)) return { error: '单价必须是数字' };
    if (!isNum(it.amount, MAX_MONEY)) return { error: '金额必须是数字' };
    if (!(it.taxable === 0 || it.taxable === 1 || typeof it.taxable === 'boolean')) return { error: '是否应税格式错误' };
  }
  const n = normalize({
    store: r.store, purchased_at: r.purchased_at, currency,
    subtotal: 0, gst: cents(r.gst), pst: cents(r.pst), total: 0,
    items: items.map((it) => ({ ...it, amount: cents(it.amount) })),
  });
  // normalize() 在单价缺失时按 金额/数量 回推，回推值可能超出 DECIMAL(10,4)，这里挡成 400 而不是让数据库报 500
  if (n.items.some((it) => it.unit_price != null && Math.abs(it.unit_price) > MAX_DERIVED_UNIT_PRICE)) return { error: '单价超出范围(请核对数量和金额)' };
  n.receipt.subtotal = cents(n.receipt.subtotal);
  n.receipt.total = cents(n.receipt.total);
  if (Math.abs(n.receipt.subtotal) > MAX_MONEY || Math.abs(n.receipt.total) > MAX_MONEY) return { error: '金额合计超出范围' };
  return { receipt: n.receipt, items: n.items };
}

module.exports = { validateEdit, realDate };
