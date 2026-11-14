'use strict';
// 把已保存的模型原始输出(raw)重新过一遍当前的 normalize()，与保存时的结果(旧 normalize 的输出)逐张对比打分。零 API 调用。
// 用法(仓库根目录): node eval/replay.cjs [--old-ref <git 引用>] <label> [<label2> ...]
// 给了 --old-ref 时，"旧"列改为该引用下 src/openrouter.cjs 的 normalize() 对同一批 raw 的结果(不写任何文件)
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { execFileSync } = require('child_process');
const { normalize, config } = require('../src/openrouter.cjs');
const { scoreReceipt, aggregate } = require('./score.cjs');
const { byId, pct } = require('./report.cjs');

const KEYS = ['gstOk', 'pstOk', 'taxSumOk', 'consistent', 'totalOk', 'subtotalOk', 'fullyCorrect'];
// 分组表里要看的项(tipFound 只在有小费的小票上有定义)
const GROUP_KEYS = ['consistent', 'tipFound', 'subtotalOk', 'fullyCorrect'];

function normalizeAt(ref) {
  const root = path.join(__dirname, '..');
  const code = execFileSync('git', ['show', `${ref}:src/openrouter.cjs`], { cwd: root, encoding: 'utf8' });
  const filename = path.join(root, 'src', `openrouter@${ref}.cjs`);
  const m = new Module(filename, module);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  m._compile(code, filename);
  return m.exports.normalize;
}

const args = process.argv.slice(2);
const refAt = args.indexOf('--old-ref');
const oldRef = refAt >= 0 ? args.splice(refAt, 2)[1] : null;
const oldNormalize = oldRef ? normalizeAt(oldRef) : null;

const count = (rows, k) => `${rows.filter((r) => r[k]).length}/${rows.filter((r) => r[k] !== undefined).length}`;

for (const label of args) {
  const dir = path.join(__dirname, 'results', label);
  const oldScores = [], newScores = [], changed = [], regressions = [];
  const groups = {};
  const flagged = { date_guessed: [], residual_added: [] };
  for (const f of fs.readdirSync(dir).sort()) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (!j.ok || j.run !== 1) continue;
    const rec = byId[j.id];
    if (rec.truth.items.length === 0) continue;
    const re = normalize(j.raw);
    const ro = oldNormalize ? oldNormalize(j.raw) : j;
    const so = scoreReceipt(rec.truth, { ...j, receipt: ro.receipt, items: ro.items }, config.categories);
    const sn = scoreReceipt(rec.truth, { ...j, receipt: re.receipt, items: re.items }, config.categories);
    oldScores.push(so); newScores.push(sn);
    const g = (groups[rec.group] ||= { old: [], new: [], residual: 0 });
    g.old.push(so); g.new.push(sn);
    if (re.receipt.residual_added) g.residual++;
    for (const k of Object.keys(flagged)) if (re.receipt[k]) flagged[k].push(`${j.id}(${rec.group})`);
    const diff = KEYS.filter((k) => so[k] !== sn[k]);
    if (diff.length) changed.push(`${j.id}: ` + diff.map((k) => `${k} ${so[k]}→${sn[k]}`).join(', ') + `  (gst/pst ${ro.receipt.gst}/${ro.receipt.pst} → ${re.receipt.gst}/${re.receipt.pst})`);
    for (const k of KEYS) if (so[k] && !sn[k]) regressions.push(`${j.id}.${k}`);
  }
  const a = aggregate(oldScores), b = aggregate(newScores);
  console.log(`\n== ${label}: 首轮 ${oldScores.length} 张小票，旧 normalize(${oldRef || '保存时的输出'}) vs 新 normalize(工作区) ==`);
  for (const k of KEYS) console.log(k.padEnd(13), 'old', pct(a[k]).padEnd(22), 'new', pct(b[k]));
  console.log('tipFound     ', 'old', pct(a.tipFound).padEnd(22), 'new', pct(b.tipFound));
  console.log('分组(旧→新):');
  for (const name of Object.keys(groups).sort()) {
    const { old: o, new: n, residual } = groups[name];
    console.log('  ' + name.padEnd(17) + GROUP_KEYS.map((k) => `${k} ${count(o, k)}→${count(n, k)}`).join('  ') + `  差额行 ${residual}/${n.length}`);
  }
  console.log('变化的小票:'); for (const c of changed) console.log('  ' + c);
  console.log('回归(旧对、新错):', regressions.length ? regressions.join(', ') : '无');
  for (const k of Object.keys(flagged)) console.log(`${k} 的小票(${flagged[k].length}):`, flagged[k].join(', ') || '无');
}
