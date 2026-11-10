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

function realDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// 返回 { error } 或 { receipt, items }(receipt 里没有 currency，由调用方沿用原值)
function validateEdit(body, currency) {
  const r = body && body.receipt;
  const items = body && body.items;
  if (!r || typeof r !== 'object' || Array.isArray(r) || !Array.isArray(items)) return { error: '数据格式错误' };
  if (typeof r.store !== 'string' || !r.store.trim() || r.store.length > 255) return { error: '商家不能为空，且不能超过 255 个字符' };
  if (!realDate(r.purchased_at)) return { error: '日期格式应为 YYYY-MM-DD' };
  if (!isNum(r.gst, MAX_MONEY) || !isNum(r.pst, MAX_MONEY)) return { error: 'GST/PST 必须是数字' };
  if (items.length < 1) return { error: '至少保留一条明细' };
  if (items.length > MAX_ITEMS) return { error: `明细最多 ${MAX_ITEMS} 条` };
  for (const it of items) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) return { error: '明细格式错误' };
    if (typeof it.name_raw !== 'string' || !it.name_raw.trim() || it.name_raw.length > 255) return { error: '品名不能为空，且不能超过 255 个字符' };
    if (it.name_norm != null && !isStr(it.name_norm, 255)) return { error: '规范品名过长' };
    if (it.subcategory != null && !isStr(it.subcategory, 100)) return { error: '细分过长' };
    if (it.unit != null && !isStr(it.unit, 50)) return { error: '单位过长' };
    if (typeof it.category !== 'string') return { error: '分类格式错误' };
    if (!isNum(it.qty, MAX_QTY)) return { error: '数量必须是数字' };
    if (it.unit_price != null && !isNum(it.unit_price, MAX_UNIT_PRICE)) return { error: '单价必须是数字' };
    if (!isNum(it.amount, MAX_MONEY)) return { error: '金额必须是数字' };
    if (!(it.taxable === 0 || it.taxable === 1 || typeof it.taxable === 'boolean')) return { error: '是否应税格式错误' };
  }
  const n = normalize({
    store: r.store, purchased_at: r.purchased_at, currency,
    subtotal: 0, gst: r.gst, pst: r.pst, total: 0, items,
  });
  if (Math.abs(n.receipt.subtotal) > MAX_MONEY || Math.abs(n.receipt.total) > MAX_MONEY) return { error: '金额合计超出范围' };
  return { receipt: n.receipt, items: n.items };
}

module.exports = { validateEdit };
