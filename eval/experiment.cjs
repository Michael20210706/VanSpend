'use strict';
// 提示词实验的验收对比: 两轮的首轮原始输出都用当前 normalize() 重新打分，再逐项对比。零 API 调用。
// 用法: node eval/experiment.cjs <基线label> <实验label>
const fs = require('fs');
const path = require('path');
const { normalize, config } = require('../src/openrouter.cjs');
const { scoreReceipt, aggregate } = require('./score.cjs');
const { byId, pct } = require('./report.cjs');

function scored(label) {
  const dir = path.join(__dirname, 'results', label);
  const out = {};
  for (const f of fs.readdirSync(dir).sort()) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (j.run !== 1 || !j.ok) continue;
    const rec = byId[j.id];
    const re = normalize(j.raw);
    out[j.id] = { j, score: scoreReceipt(rec.truth, { ...j, receipt: re.receipt, items: re.items }, config.categories), receipt: re.receipt };
  }
  return out;
}

const [a, b] = process.argv.slice(2);
const A = scored(a), B = scored(b);
const ids = Object.keys(A).filter((id) => B[id] && byId[id].truth.items.length > 0);
const agg = (S) => aggregate(ids.map((id) => S[id].score));
const x = agg(A), y = agg(B);
const rows = [
  ['tipFound', x.tipFound, y.tipFound],
  ['itemF1', { p: x.items.f1, k: '', n: '' }, { p: y.items.f1, k: '', n: '' }],
  ['subtotalOk', x.subtotalOk, y.subtotalOk], ['gstOk', x.gstOk, y.gstOk], ['pstOk', x.pstOk, y.pstOk], ['totalOk', x.totalOk, y.totalOk],
  ['taxableOnMatched', x.taxableOnMatched, y.taxableOnMatched], ['qtyOnMatched', x.qtyOnMatched, y.qtyOnMatched],
  ['consistent', x.consistent, y.consistent], ['fullyCorrect', x.fullyCorrect, y.fullyCorrect],
];
console.log(`${a} vs ${b}: ${ids.length} 张小票(首轮, 当前 normalize)`);
for (const [k, p, q] of rows) {
  const f = (w) => (k === 'itemF1' ? w.p.toFixed(3) : pct(w));
  console.log(k.padEnd(17), a.padEnd(9), f(p).padEnd(24), b.padEnd(9), f(q));
}
const keys = ['storeOk', 'dateOk', 'countOk', 'subtotalOk', 'gstOk', 'pstOk', 'totalOk', 'consistent', 'fullyCorrect', 'tipFound'];
console.log('逐张变化:');
for (const id of ids) {
  const d = keys.filter((k) => A[id].score[k] !== B[id].score[k]).map((k) => `${k} ${A[id].score[k]}→${B[id].score[k]}`);
  if (d.length || A[id].score.predItems !== B[id].score.predItems) console.log(`  ${id}: items ${A[id].score.predItems}→${B[id].score.predItems}${d.length ? ', ' + d.join(', ') : ''}`);
}
const reg = ids.filter((id) => A[id].score.fullyCorrect && !B[id].score.fullyCorrect);
console.log('基线全对、实验变错:', reg.length ? reg.join(', ') : '无');
const na = ids.length; void na;
for (const id of Object.keys(A).filter((i) => byId[i].truth.items.length === 0)) console.log('非小票', id, a, A[id].score.fullyCorrect, b, B[id] ? B[id].score.fullyCorrect : 'n/a');
