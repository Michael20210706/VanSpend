'use strict';
// 读取 eval/results/<label>/*.json 打分并输出 JSON 汇总(给文档用)。用法: node eval/report.cjs <label> [<label2>]
const fs = require('fs');
const path = require('path');
const { scoreReceipt, aggregate } = require('./score.cjs');
const { config } = require('../src/openrouter.cjs');

const ds = JSON.parse(fs.readFileSync(path.join(__dirname, 'dataset.json'), 'utf8'));
const byId = Object.fromEntries(ds.receipts.map((r) => [r.id, r]));

function load(label) {
  const dir = path.join(__dirname, 'results', label);
  const rows = [];
  for (const f of fs.readdirSync(dir).sort()) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const rec = byId[j.id];
    const score = j.ok ? scoreReceipt(rec.truth, j, config.categories)
      : { nonReceipt: rec.truth.items.length === 0, fullyCorrect: false, failed: true, truthItems: rec.truth.items.length, predItems: 0, tp: 0 };
    rows.push({ id: j.id, run: j.run, group: rec.group, features: rec.features, ok: j.ok, score, pred: j.ok ? j : null });
  }
  return rows;
}

const pct = (w) => (w.p == null ? 'n/a' : `${(w.p * 100).toFixed(0)}% [${(w.lo * 100).toFixed(0)}-${(w.hi * 100).toFixed(0)}] (${w.k}/${w.n})`);

function summarize(rows, firstRunOnly) {
  const use = firstRunOnly ? rows.filter((r) => r.run === 1) : rows;
  return { agg: aggregate(use.map((r) => r.score)), n: use.length };
}

if (require.main === module) {
  for (const label of process.argv.slice(2)) {
    const rows = load(label);
    const { agg } = summarize(rows, true);
    console.log(`\n== ${label} (首轮, ${rows.filter((r) => r.run === 1).length} 张) ==`);
    for (const k of ['storeOk', 'dateOk', 'countOk', 'subtotalOk', 'gstOk', 'pstOk', 'totalOk', 'taxSumOk', 'consistent', 'fullyCorrect']) console.log(k.padEnd(14), pct(agg[k]));
    console.log('items P/R/F1', pct(agg.items.precision), pct(agg.items.recall), agg.items.f1.toFixed(3));
    console.log('qty/taxable on matched', pct(agg.qtyOnMatched), pct(agg.taxableOnMatched));
    console.log('categoryValid', pct(agg.categoryValid), 'tipFound', pct(agg.tipFound), 'nonReceipt', JSON.stringify(agg.nonReceipt));
  }
}
module.exports = { load, summarize, pct, byId };
