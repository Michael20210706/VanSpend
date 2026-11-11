'use strict';
// 识别结果打分(纯函数，不调用任何网络)。pred 是 scanReceipt() 的返回值 { receipt, items }，即 normalize() 之后、App 实际会入库的结构。

const MONEY_EPS = 0.01 + 1e-9;
const SUM_EPS = 0.02 + 1e-9;
const close = (a, b, eps = MONEY_EPS) => Math.abs(Number(a) - Number(b)) <= eps;

function normStore(s) {
  return String(s || '').toLowerCase().replace(/[\s'’"`.,\-_&()（）·]/g, '');
}

// 归一化后相等，或一方包含另一方(较短一方至少 2 个字符)
function storeMatch(truthStore, predStore) {
  const a = normStore(truthStore), b = normStore(predStore);
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 2 && long.includes(short);
}

// 一对一按金额(±0.01)匹配明细: 每条真值明细取第一个未用过、金额相同的预测行，多个候选时优先数量也一致的
function matchItems(truthItems, predItems) {
  const used = new Set();
  const pairs = [];
  for (const t of truthItems) {
    let pick = -1;
    for (let i = 0; i < predItems.length; i++) {
      if (used.has(i) || !close(predItems[i].amount, t.amount)) continue;
      if (pick === -1) pick = i;
      if (close(predItems[i].qty, t.qty, 0.01)) { pick = i; break; }
    }
    if (pick !== -1) { used.add(pick); pairs.push([t, predItems[pick]]); }
  }
  return pairs;
}

function scoreReceipt(truth, pred, validCategories) {
  const items = pred.items || [];
  const r = pred.receipt || {};
  if (truth.items.length === 0) {
    const ok = items.length === 0;
    return { nonReceipt: true, fullyCorrect: ok, predItems: items.length };
  }
  const pairs = matchItems(truth.items, items);
  const tp = pairs.length;
  const qtyOk = pairs.filter(([t, p]) => close(p.qty, t.qty, 0.01)).length;
  const taxOk = pairs.filter(([t, p]) => Boolean(p.taxable) === Boolean(t.taxable)).length;
  const cats = new Set(validCategories || []);
  const catValid = validCategories ? items.filter((i) => cats.has(i.category)).length : items.length;
  const m = {
    nonReceipt: false,
    storeOk: storeMatch(truth.store, r.store),
    dateOk: r.purchased_at === truth.date,
    countOk: items.length === truth.items.length,
    truthItems: truth.items.length,
    predItems: items.length,
    tp,
    qtyOk,
    taxableOk: taxOk,
    catValid,
    subtotalOk: close(r.subtotal, truth.subtotal),
    gstOk: close(r.gst, truth.gst),
    pstOk: close(r.pst, truth.pst),
    totalOk: close(r.total, truth.total),
    taxSumOk: close(Number(r.gst) + Number(r.pst), truth.gst + truth.pst),
    consistent: close(Number(r.subtotal) + Number(r.gst) + Number(r.pst), r.total, SUM_EPS),
  };
  const tipTruth = truth.items.find((i) => i.is_tip);
  if (tipTruth) m.tipFound = pairs.some(([t]) => t === tipTruth);
  m.fullyCorrect = m.storeOk && m.dateOk && tp === truth.items.length && items.length === truth.items.length
    && qtyOk === tp && taxOk === tp && m.subtotalOk && m.gstOk && m.pstOk && m.totalOk;
  return m;
}

function wilson(k, n, z = 1.96) {
  if (!n) return { p: null, lo: null, hi: null, k, n };
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { p, lo: Math.max(0, c - h), hi: Math.min(1, c + h), k, n };
}

const PROPS = ['storeOk', 'dateOk', 'countOk', 'subtotalOk', 'gstOk', 'pstOk', 'totalOk', 'taxSumOk', 'consistent', 'fullyCorrect'];

// scores: 每张小票一个 scoreReceipt 结果(同一张图多次运行则每次一条)。小票图片的比例指标按"运行"为单位，非小票单独统计。
function aggregate(scores) {
  const rec = scores.filter((s) => !s.nonReceipt);
  const out = { receipts: rec.length };
  for (const k of PROPS) out[k] = wilson(rec.filter((s) => s[k]).length, rec.length);
  const sum = (k) => rec.reduce((a, s) => a + (s[k] || 0), 0);
  const tp = sum('tp'), pn = sum('predItems'), tn = sum('truthItems');
  const prec = pn ? tp / pn : 0, recall = tn ? tp / tn : 0;
  out.items = { tp, predicted: pn, truth: tn, precision: wilson(tp, pn), recall: wilson(tp, tn), f1: prec + recall ? (2 * prec * recall) / (prec + recall) : 0 };
  out.qtyOnMatched = wilson(sum('qtyOk'), tp);
  out.taxableOnMatched = wilson(sum('taxableOk'), tp);
  out.categoryValid = wilson(sum('catValid'), pn);
  const tips = rec.filter((s) => s.tipFound !== undefined);
  out.tipFound = wilson(tips.filter((s) => s.tipFound).length, tips.length);
  const nr = scores.filter((s) => s.nonReceipt);
  out.nonReceipt = { n: nr.length, emptyOk: nr.filter((s) => s.fullyCorrect).length };
  return out;
}

module.exports = { scoreReceipt, aggregate, wilson, storeMatch, matchItems, close };
