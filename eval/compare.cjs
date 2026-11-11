'use strict';
// 对比两轮(label)在同一批图上的逐张结果与分组指标。用法: node eval/compare.cjs baseline after
const { load, pct, byId } = require('./report.cjs');
const { aggregate } = require('./score.cjs');
const [a, b] = process.argv.slice(2);
const A = load(a), B = load(b);
const first = (rows) => rows.filter((r) => r.run === 1);
const fmt = (r) => {
  const s = r.score;
  if (s.nonReceipt) return `空=${s.fullyCorrect}`;
  if (s.failed) return 'FAILED';
  const p = r.pred.receipt;
  return `${s.fullyCorrect ? 'FULL' : '    '} 行${s.predItems}/${s.truthItems} tp${s.tp} sub${p.subtotal} gst${p.gst} pst${p.pst} tot${p.total}${s.consistent ? '' : ' INCONS'}`;
};
console.log('--- 逐张(首轮)');
for (const r of first(A)) {
  const q = first(B).find((x) => x.id === r.id);
  const t = byId[r.id].truth;
  console.log(r.id.padEnd(14), `truth sub${t.subtotal} gst${t.gst} pst${t.pst} tot${t.total}`);
  console.log('   ', a.padEnd(9), fmt(r));
  console.log('   ', b.padEnd(9), fmt(q));
}
console.log('--- 分组(首轮, 小票图)');
const groups = [...new Set(first(A).map((r) => r.group))];
for (const g of groups) {
  const ra = first(A).filter((r) => r.group === g), rb = first(B).filter((r) => r.group === g);
  const x = aggregate(ra.map((r) => r.score)), y = aggregate(rb.map((r) => r.score));
  if (!x.receipts) continue;
  const f = (k) => `${x[k].k}/${x[k].n}->${y[k].k}/${y[k].n}`;
  console.log(g.padEnd(18), 'full', f('fullyCorrect'), 'gst', f('gstOk'), 'pst', f('pstOk'), 'taxSum', f('taxSumOk'), 'consistent', f('consistent'), 'total', f('totalOk'), 'sub', f('subtotalOk'), 'itemsF1', x.items.f1.toFixed(2) + '->' + y.items.f1.toFixed(2));
}
console.log('--- 运行间波动(同图多次运行, 每个 label)');
for (const [lab, rows] of [[a, A], [b, B]]) {
  for (const id of [...new Set(rows.map((r) => r.id))]) {
    const rs = rows.filter((r) => r.id === id);
    if (rs.length < 2) continue;
    const sigs = rs.map((r) => (r.pred ? JSON.stringify({ r: r.pred.receipt, i: r.pred.items.map((i) => [i.amount, i.qty, i.taxable]) }) : 'fail'));
    const same = new Set(sigs).size === 1;
    const fc = rs.map((r) => (r.score.fullyCorrect ? 1 : 0)).join('');
    console.log(lab.padEnd(9), id.padEnd(8), `runs=${rs.length} 关键字段完全一致=${same} fullyCorrect=${fc}`);
  }
}
