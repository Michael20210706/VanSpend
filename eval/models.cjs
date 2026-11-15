'use strict';
// 模型对比(H-M): 把各轮保存的模型原始输出(raw)重新过当前的 normalize() 打分，连同 token、费用、耗时输出 Markdown 表和验收结论。零 API 调用。
// 用法(仓库根目录): node eval/models.cjs
// 新一轮结果先用 run.cjs 生成(见 docs/qa/2026-11-14-model-comparison.md)，再把 label 填进 RUNS。
const fs = require('fs');
const path = require('path');
const { normalize, config } = require('../src/openrouter.cjs');
const { scoreReceipt, aggregate } = require('./score.cjs');
const { byId } = require('./report.cjs');

const RUNS = [
  { model: 'flash-lite', set: 'tuning', label: 'baseline' },
  { model: 'flash-lite', set: 'holdout', label: 'models-lite-holdout' },
  { model: 'flash', set: 'tuning', label: 'models-flash-tuning' },
  { model: 'flash', set: 'holdout', label: 'models-flash-holdout' },
];
const SET_NAME = { tuning: '首轮 25 张', holdout: '保留集 12 张' };

// 公开标价(美元 / 百万 token)。只在 API 没返回 cost 时用来估算(标"推断")，以及用来核对 API 返回的 cost。
const PRICES = { 'flash-lite': { in: 0.1, out: 0.4 }, flash: { in: 0.3, out: 2.5 } };

// 验收规则，写在任何模型调用之前(docs/qa/2026-11-14-optimization-round.md 的 H-M):
// 只有保留集上 flash 的整张全对比 flash-lite 多 >= 3 张，且每次扫描费用 <= flash-lite 的 2 倍，才建议切换。
// "每次扫描费用"取保留集上每次调用费用的中位数(含解析失败但已计费的调用)；均值一并列出。费用缺失时视为未验证，不建议切换。
const RULE = { minExtraFullyCorrect: 3, maxCostRatio: 2 };

function median(xs) {
  const a = xs.filter((x) => Number.isFinite(x)).sort((p, q) => p - q);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
const mean = (xs) => { const a = xs.filter((x) => Number.isFinite(x)); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; };

// usage 是 OpenRouter 返回的对象。有 cost 用 cost(测量)，否则按标价估算(推断)，没有 usage 则为 null。
function costOf(usage, modelKey) {
  if (!usage) return { cost: null, source: null };
  if (Number.isFinite(usage.cost)) return { cost: usage.cost, source: '测量' };
  const p = PRICES[modelKey];
  if (!p || !Number.isFinite(usage.prompt_tokens) || !Number.isFinite(usage.completion_tokens)) return { cost: null, source: null };
  return { cost: (usage.prompt_tokens * p.in + usage.completion_tokens * p.out) / 1e6, source: '推断' };
}

function decide({ liteFull, flashFull, liteCost, flashCost }) {
  const extra = flashFull - liteFull;
  const ratio = Number.isFinite(liteCost) && Number.isFinite(flashCost) && liteCost > 0 ? flashCost / liteCost : null;
  const accuracyOk = extra >= RULE.minExtraFullyCorrect;
  const costOk = ratio == null ? null : ratio <= RULE.maxCostRatio;
  return { extra, ratio, accuracyOk, costOk, recommendSwitch: accuracyOk && costOk === true };
}

function loadRun(run) {
  const dir = path.join(__dirname, 'results', run.label);
  if (!fs.existsSync(dir)) return null;
  const rows = [];
  for (const f of fs.readdirSync(dir).sort()) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (j.run !== 1) continue;
    const rec = byId[j.id];
    if (!rec || rec.set !== run.set) throw new Error(`${run.label}/${f}: 不属于数据集 ${run.set}`);
    const re = j.ok ? normalize(j.raw) : null;
    const score = j.ok ? scoreReceipt(rec.truth, { receipt: re.receipt, items: re.items }, config.categories)
      : { nonReceipt: rec.truth.items.length === 0, fullyCorrect: false, failed: true, truthItems: rec.truth.items.length, predItems: 0, tp: 0 };
    const u = j.usage || null;
    rows.push({
      id: j.id, rec, ok: j.ok, error: j.error || null, score,
      ms: Number.isFinite(j.apiMs) ? j.apiMs : j.attempts === 1 ? j.ms : null,
      msKind: Number.isFinite(j.apiMs) ? 'api' : 'wall',
      model: j.model || null, provider: j.provider || null,
      tokensIn: u ? u.prompt_tokens : null, tokensOut: u ? u.completion_tokens : null,
      reasoning: u && u.completion_tokens_details ? u.completion_tokens_details.reasoning_tokens ?? null : null,
      ...costOf(u, run.model),
    });
  }
  return rows;
}

const cell = (w) => (w.n ? `${(w.p * 100).toFixed(0)}% [${(w.lo * 100).toFixed(0)}–${(w.hi * 100).toFixed(0)}] (${w.k}/${w.n})` : 'n/a');
const num = (x, d = 0) => (x == null ? '无数据' : x.toFixed(d));
const usd = (x) => (x == null ? '无数据' : '$' + x.toFixed(6));

function whyWrong(s) {
  if (s.failed) return '调用失败';
  if (s.nonReceipt) return s.fullyCorrect ? '' : `非小票却返回 ${s.predItems} 行`;
  const out = [];
  if (!s.storeOk) out.push('商家');
  if (!s.dateOk) out.push('日期');
  if (s.tp !== s.truthItems || s.predItems !== s.truthItems) out.push(`明细 匹配${s.tp}/答案${s.truthItems}/输出${s.predItems}`);
  if (s.qtyOk !== s.tp) out.push(`qty 错${s.tp - s.qtyOk}`);
  if (s.taxableOk !== s.tp) out.push(`taxable 错${s.tp - s.taxableOk}`);
  for (const [k, n] of [['subtotalOk', 'subtotal'], ['gstOk', 'gst'], ['pstOk', 'pst'], ['totalOk', 'total']]) if (!s[k]) out.push(n);
  return out.join('; ');
}

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

function main() {
  const loaded = RUNS.map((r) => ({ ...r, rows: loadRun(r) }));
  const have = loaded.filter((r) => r.rows);
  for (const r of loaded) if (!r.rows) console.log(`(尚未运行: ${r.label})`);
  const head = (label) => `| ${label} | ` + have.map((r) => `${r.model} / ${SET_NAME[r.set]}`).join(' | ') + ' |\n|---|' + have.map(() => '---').join('|') + '|';
  const line = (name, f) => console.log(`| ${name} | ` + have.map(f).join(' | ') + ' |');
  const agg = new Map(have.map((r) => [r, aggregate(r.rows.map((x) => x.score))]));
  const receiptRows = (r) => r.rows.filter((x) => !x.score.nonReceipt);

  console.log('\n### 准确率(每张 1 次; 当前 worktree 的 normalize() 重放; 方括号是 95% Wilson 区间)\n');
  console.log(head('指标'));
  line('label', (r) => '`' + r.label + '`');
  line('API 回报的模型', (r) => [...new Set(r.rows.map((x) => x.model || '未记录'))].join(', '));
  line('调用失败(计为错)', (r) => String(r.rows.filter((x) => !x.ok).length));
  line('整张完全正确', (r) => cell(agg.get(r).fullyCorrect));
  for (const [n, k] of [['subtotal ±0.01', 'subtotalOk'], ['gst ±0.01', 'gstOk'], ['pst ±0.01', 'pstOk'], ['total ±0.01', 'totalOk'], ['subtotal+gst+pst = total', 'consistent'], ['日期完全一致', 'dateOk'], ['商家名匹配', 'storeOk']]) line(n, (r) => cell(agg.get(r)[k]));
  line('日期(写法无歧义的小票)', (r) => { const u = receiptRows(r).filter((x) => !x.rec.dateAmbiguous); return `${u.filter((x) => x.score.dateOk).length}/${u.length}`; });
  line('明细精确率(行)', (r) => cell(agg.get(r).items.precision));
  line('明细召回率(行)', (r) => cell(agg.get(r).items.recall));
  line('明细 F1', (r) => agg.get(r).items.f1.toFixed(3));
  line('已匹配行 taxable 正确', (r) => cell(agg.get(r).taxableOnMatched));
  line('小费行被提取', (r) => cell(agg.get(r).tipFound));
  line('非小票图返回空明细', (r) => `${agg.get(r).nonReceipt.emptyOk}/${agg.get(r).nonReceipt.n}`);

  console.log('\n### 耗时、token 与费用(每次调用; 中位数 [最小–最大])\n');
  console.log(head('指标'));
  const mm = (xs, d = 0) => { const a = xs.filter((x) => Number.isFinite(x)); return a.length ? `${num(median(a), d)} [${Math.min(...a).toFixed(d)}–${Math.max(...a).toFixed(d)}] (n=${a.length})` : '无数据'; };
  line('耗时 ms', (r) => mm(r.rows.map((x) => x.ms)) + (r.rows.some((x) => x.msKind === 'wall') ? ' 整体耗时，非单次请求' : ''));
  line('输入 token', (r) => mm(r.rows.map((x) => x.tokensIn)));
  line('输出 token(含推理)', (r) => mm(r.rows.map((x) => x.tokensOut)));
  line('其中推理 token', (r) => mm(r.rows.map((x) => x.reasoning)));
  line('每次费用 中位数 USD', (r) => usd(median(r.rows.map((x) => x.cost))));
  line('每次费用 均值 USD', (r) => usd(mean(r.rows.map((x) => x.cost))));
  line('该轮总费用 USD', (r) => { const c = r.rows.map((x) => x.cost).filter(Number.isFinite); return c.length ? '$' + c.reduce((s, x) => s + x, 0).toFixed(5) : '无数据'; });
  line('费用来源', (r) => [...new Set(r.rows.map((x) => x.source || '无'))].join(', '));
  line('provider', (r) => [...new Set(r.rows.map((x) => x.provider || '未记录'))].join(', '));
  line('耗时与输出 token 的相关系数', (r) => { const u = r.rows.filter((x) => Number.isFinite(x.ms) && Number.isFinite(x.tokensOut)); const c = pearson(u.map((x) => x.tokensOut), u.map((x) => x.ms)); return c == null ? '无数据' : c.toFixed(2); });
  line('输出 token / 秒 中位数', (r) => num(median(r.rows.filter((x) => x.ms && Number.isFinite(x.tokensOut)).map((x) => x.tokensOut / (x.ms / 1000))), 0));
  line('API cost ÷ 标价估算 中位数', (r) => num(median(r.rows.filter((x) => x.source === '测量' && Number.isFinite(x.tokensIn)).map((x) => x.cost / ((x.tokensIn * PRICES[r.model].in + x.tokensOut * PRICES[r.model].out) / 1e6))), 2));

  const pick = (model, set) => loaded.find((r) => r.model === model && r.set === set && r.rows);
  for (const set of ['holdout', 'tuning']) {
    const L = pick('flash-lite', set), F = pick('flash', set);
    if (!L || !F) continue;
    console.log(`\n### 逐张(${SET_NAME[set]})\n\n| 图 | 组 | flash-lite | flash |\n|---|---|---|---|`);
    const tally = { both: 0, onlyLite: 0, onlyFlash: 0, neither: 0 };
    for (const a of L.rows) {
      const b = F.rows.find((x) => x.id === a.id);
      if (!b) continue;
      const fa = a.score.fullyCorrect, fb = b.score.fullyCorrect;
      if (!a.score.nonReceipt) tally[fa && fb ? 'both' : fa ? 'onlyLite' : fb ? 'onlyFlash' : 'neither']++;
      console.log(`| ${a.id} | ${a.rec.group || '非小票'} | ${fa ? '全对' : '错: ' + whyWrong(a.score)} | ${fb ? '全对' : '错: ' + whyWrong(b.score)} |`);
    }
    console.log(`\n配对(小票图): 两个都全对 ${tally.both}，只有 flash-lite 全对 ${tally.onlyLite}，只有 flash 全对 ${tally.onlyFlash}，都不全对 ${tally.neither}`);
  }

  const L = pick('flash-lite', 'holdout'), F = pick('flash', 'holdout');
  if (L && F) {
    const d = decide({
      liteFull: agg.get(L).fullyCorrect.k, flashFull: agg.get(F).fullyCorrect.k,
      liteCost: median(L.rows.map((x) => x.cost)), flashCost: median(F.rows.map((x) => x.cost)),
    });
    const meanRatio = mean(F.rows.map((x) => x.cost)) / mean(L.rows.map((x) => x.cost));
    console.log('\n### 验收(H-M，规则先于调用写定)\n');
    console.log(`- 保留集整张全对: flash ${agg.get(F).fullyCorrect.k}/${agg.get(F).fullyCorrect.n}，flash-lite ${agg.get(L).fullyCorrect.k}/${agg.get(L).fullyCorrect.n}，差 ${d.extra >= 0 ? '+' : ''}${d.extra}(要求 ≥ +${RULE.minExtraFullyCorrect}): ${d.accuracyOk ? '满足' : '不满足'}`);
    console.log(`- 每次扫描费用(保留集中位数): flash ${usd(median(F.rows.map((x) => x.cost)))}，flash-lite ${usd(median(L.rows.map((x) => x.cost)))}，比值 ${d.ratio == null ? '无数据' : d.ratio.toFixed(2) + '×'}(要求 ≤ ${RULE.maxCostRatio}×; 按均值算 ${Number.isFinite(meanRatio) ? meanRatio.toFixed(2) + '×' : '无数据'}): ${d.costOk == null ? '无法验证' : d.costOk ? '满足' : '不满足'}`);
    console.log(`- 结论: ${d.recommendSwitch ? '建议切换到 flash' : '建议保持 flash-lite'}`);
  }

  const base = path.join(__dirname, 'results', 'baseline');
  if (fs.existsSync(base)) {
    const byImage = {};
    for (const f of fs.readdirSync(base).sort()) {
      const j = JSON.parse(fs.readFileSync(path.join(base, f), 'utf8'));
      if (!j.ok || byId[j.id].truth.items.length === 0) continue;
      const re = normalize(j.raw);
      (byImage[j.id] ||= []).push(scoreReceipt(byId[j.id].truth, { receipt: re.receipt, items: re.items }, config.categories).fullyCorrect ? 1 : 0);
    }
    const rep = Object.entries(byImage).filter(([, v]) => v.length > 1);
    console.log(`\n### 运行间波动(flash-lite，首轮里重复跑过的 ${rep.length} 张，各 ${rep[0] ? rep[0][1].length : 0} 次，温度 0)\n`);
    console.log(rep.map(([id, v]) => `${id} ${v.join('')}`).join('，'));
    console.log(`整张全对在重复运行间翻转的图: ${rep.filter(([, v]) => new Set(v).size > 1).length}/${rep.length}`);
  }
}

if (require.main === module) main();
module.exports = { median, mean, costOf, decide, RULE, RUNS, PRICES };
