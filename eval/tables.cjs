'use strict';
// 生成文档里的 Markdown 表格。用法: node eval/tables.cjs baseline after
const { load, byId } = require('./report.cjs');
const { aggregate } = require('./score.cjs');
const [A, B] = process.argv.slice(2);
const first = (l) => load(l).filter((r) => r.run === 1);
const cell = (w) => (w.n ? `${(w.p * 100).toFixed(0)}% [${(w.lo * 100).toFixed(0)}–${(w.hi * 100).toFixed(0)}] (${w.k}/${w.n})` : 'n/a');
const a = aggregate(first(A).map((r) => r.score)), b = aggregate(first(B).map((r) => r.score));

console.log('### 数据集\n\n| id | 组 | 商家 | 明细行(含小费行) | 印出的税 | 特征 | 日期写法有歧义 |\n|---|---|---|---|---|---|---|');
const ds = require('./dataset.json');
for (const r of ds.receipts) {
  const t = r.truth;
  const tax = r.nonreceipt ? '—' : r.features.includes('combined_tax') ? '只印 1 行合计税' : t.pst === 0 && t.gst > 0 && r.group !== 'costco' && r.features.includes('tip') ? '只印 GST' : r.group === 'chinese' && t.pst === 0 ? '只印 GST' : '分别印 GST / PST';
  console.log(`| ${r.id} | ${r.group} | ${t.store || '(非小票)'} | ${t.items.length} | ${tax} | ${r.features.join(', ') || '—'} | ${r.dateAmbiguous ? '是' : ''} |`);
}

console.log('\n### 整体(首轮 1 次/张; 小票图 24 张)\n\n| 指标 | 基线(旧提示词) | 新提示词 |\n|---|---|---|');
const rows = [['商家名匹配', 'storeOk'], ['日期完全一致', 'dateOk'], ['明细行数一致', 'countOk'], ['subtotal ±0.01', 'subtotalOk'], ['gst ±0.01', 'gstOk'], ['pst ±0.01', 'pstOk'], ['total ±0.01', 'totalOk'], ['gst+pst 之和正确(不论拆分)', 'taxSumOk'], ['subtotal+gst+pst = total (±0.02)', 'consistent'], ['整张"完全正确"', 'fullyCorrect']];
for (const [n, k] of rows) console.log(`| ${n} | ${cell(a[k])} | ${cell(b[k])} |`);
console.log(`| 明细精确率(行) | ${cell(a.items.precision)} | ${cell(b.items.precision)} |`);
console.log(`| 明细召回率(行) | ${cell(a.items.recall)} | ${cell(b.items.recall)} |`);
console.log(`| 明细 F1 | ${a.items.f1.toFixed(3)} | ${b.items.f1.toFixed(3)} |`);
console.log(`| 已匹配行 qty 正确 | ${cell(a.qtyOnMatched)} | ${cell(b.qtyOnMatched)} |`);
console.log(`| 已匹配行 taxable 正确 | ${cell(a.taxableOnMatched)} | ${cell(b.taxableOnMatched)} |`);
console.log(`| 分类在白名单内(行) | ${cell(a.categoryValid)} | ${cell(b.categoryValid)} |`);
console.log(`| 小费行被提取(4 张有小费) | ${cell(a.tipFound)} | ${cell(b.tipFound)} |`);
console.log(`| 非小票图返回空明细 | ${a.nonReceipt.emptyOk}/${a.nonReceipt.n} | ${b.nonReceipt.emptyOk}/${b.nonReceipt.n} |`);

console.log('\n### 分组(首轮; 格式 基线→新提示词, 正确数/张数)\n\n| 组 | 张数 | 完全正确 | gst | pst | gst+pst 之和 | 一致性 | 小费被提取 | 明细 F1 |\n|---|---|---|---|---|---|---|---|---|');
for (const g of [...new Set(first(A).map((r) => r.group))]) {
  const x = aggregate(first(A).filter((r) => r.group === g).map((r) => r.score));
  const y = aggregate(first(B).filter((r) => r.group === g).map((r) => r.score));
  if (!x.receipts) continue;
  const f = (k) => `${x[k].k}→${y[k].k} /${x[k].n}`;
  console.log(`| ${g} | ${x.receipts} | ${f('fullyCorrect')} | ${f('gstOk')} | ${f('pstOk')} | ${f('taxSumOk')} | ${f('consistent')} | ${x.tipFound.n ? f('tipFound') : '—'} | ${x.items.f1.toFixed(2)}→${y.items.f1.toFixed(2)} |`);
}
console.log('\n### #28 合计税四张: 旧/新输出 vs 答案\n\n| 图 | 答案 gst/pst | 旧 gst/pst | 新 gst/pst |\n|---|---|---|---|');
for (const id of ['tnt-01', 'tnt-02', 'tnt-03', 'tnt-04']) {
  const t = byId[id].truth, x = first(A).find((r) => r.id === id).pred.receipt, y = first(B).find((r) => r.id === id).pred.receipt;
  console.log(`| ${id} | ${t.gst} / ${t.pst} | ${x.gst} / ${x.pst} | ${y.gst} / ${y.pst} |`);
}
