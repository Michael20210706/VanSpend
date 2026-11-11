'use strict';
// 把已保存的模型原始输出(raw)重新过一遍当前的 normalize()，与保存时的结果(旧 normalize 的输出)逐张对比打分。零 API 调用。
// 用法(仓库根目录): node eval/replay.cjs <label> [<label2> ...]
const fs = require('fs');
const path = require('path');
const { normalize, config } = require('../src/openrouter.cjs');
const { scoreReceipt, aggregate } = require('./score.cjs');
const { byId, pct } = require('./report.cjs');

const KEYS = ['gstOk', 'pstOk', 'taxSumOk', 'consistent', 'totalOk', 'subtotalOk', 'fullyCorrect'];

for (const label of process.argv.slice(2)) {
  const dir = path.join(__dirname, 'results', label);
  const oldScores = [], newScores = [], changed = [], regressions = [];
  for (const f of fs.readdirSync(dir).sort()) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (!j.ok || j.run !== 1) continue;
    const rec = byId[j.id];
    if (rec.truth.items.length === 0) continue;
    const re = normalize(j.raw);
    const so = scoreReceipt(rec.truth, j, config.categories);
    const sn = scoreReceipt(rec.truth, { ...j, receipt: re.receipt, items: re.items }, config.categories);
    oldScores.push(so); newScores.push(sn);
    const diff = KEYS.filter((k) => so[k] !== sn[k]);
    if (diff.length) changed.push(`${j.id}: ` + diff.map((k) => `${k} ${so[k]}→${sn[k]}`).join(', ') + `  (gst/pst ${j.receipt.gst}/${j.receipt.pst} → ${re.receipt.gst}/${re.receipt.pst})`);
    for (const k of KEYS) if (so[k] && !sn[k]) regressions.push(`${j.id}.${k}`);
  }
  const a = aggregate(oldScores), b = aggregate(newScores);
  console.log(`\n== ${label}: 首轮 ${oldScores.length} 张小票，旧 normalize vs 新 normalize ==`);
  for (const k of KEYS) console.log(k.padEnd(13), 'old', pct(a[k]).padEnd(22), 'new', pct(b[k]));
  console.log('变化的小票:'); for (const c of changed) console.log('  ' + c);
  console.log('回归(旧对、新错):', regressions.length ? regressions.join(', ') : '无');
}
