'use strict';
// 对 eval/dataset.json 的每张图调用真实的 scanReceipt(src/openrouter.cjs)，原始输出存到 eval/results/<label>/。
// 用法(在仓库根目录): node eval/run.cjs <label> [--extra 2] [--only id1,id2] [--dataset dataset-holdout.json]
//   每张图跑 1 次; VARIABILITY_IDS 里的图额外再跑 --extra 次(默认 2, 共 3 次)用来看运行间波动。--dataset 换用 eval/ 下别的数据集文件(如保留集)。
//   每条结果另存 API 回报的 model 与 provider、请求时用的 requestedModel、usage(token 数与费用)与 apiMs(最后一次请求的耗时，不含重试)。
//   模型: 命令行里的 OPENROUTER_MODEL 优先于 .env，.env 优先于 config.json(见 src/openrouter.cjs)。例: OPENROUTER_MODEL=google/gemini-2.5-flash node eval/run.cjs <label> --extra 0
// 费用护栏(可用环境变量 EVAL_HARD_CAP / EVAL_CALLS_FILE 给某一轮单独的上限与计数文件): 所有"尝试"(含重试)累计写入 eval/results/calls.json, 到 HARD_CAP 就拒绝继续。已有成功结果的 (id,run) 会跳过，不重复计费。
//   EVAL_CALLS_FILE 只写文件名时放在 eval/results/ 下，带目录时按当前目录解析(calls-models.json 与 eval/results/calls-models.json 是同一个文件)。
// 不读不打印 API key: 模块自己从 .env 加载。
const fs = require('fs');
const path = require('path');
const { scanReceipt, config } = require('../src/openrouter.cjs');

const HARD_CAP = Number(process.env.EVAL_HARD_CAP || 120);
const CONCURRENCY = 3;
const VARIABILITY_IDS = ['tnt-01', 'tnt-03', 'rest-01', 'disc-01', 'deg-01', 'long-01'];
const root = __dirname;
const callsArg = process.env.EVAL_CALLS_FILE || 'calls.json';
const callsFile = /[\\/]/.test(callsArg) ? path.resolve(process.cwd(), callsArg) : path.join(root, 'results', callsArg);

function readCalls() { return fs.existsSync(callsFile) ? JSON.parse(fs.readFileSync(callsFile, 'utf8')) : { total: 0, byLabel: {} }; }
function bumpCalls(label) {
  const c = readCalls();
  if (c.total >= HARD_CAP) throw new Error(`已达调用上限 ${HARD_CAP}，停止`);
  c.total += 1; c.byLabel[label] = (c.byLabel[label] || 0) + 1;
  fs.writeFileSync(callsFile, JSON.stringify(c, null, 1));
}

async function callOnce(label, dataUrl, meta) {
  bumpCalls(label);
  return scanReceipt(dataUrl, { onMeta: (m) => Object.assign(meta, m) });
}

const isTransport = (e) => /fetch failed|请求失败|ECONN|ETIMEDOUT|network/i.test(String(e && e.message));

async function runJob(label, rec, run, outDir, dsFile) {
  const file = path.join(outDir, `${rec.id}.${run}.json`);
  if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).ok) return 'skipped';
  const dataUrl = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(root, 'images', rec.id + '.jpg')).toString('base64');
  const t0 = Date.now();
  let res, err, attempts = 0;
  const meta = {};
  for (; attempts < 2; ) {
    attempts++;
    try { res = await callOnce(label, dataUrl, meta); err = null; break; } catch (e) { err = e; if (!isTransport(e) || attempts >= 2) break; }
  }
  const head = { id: rec.id, run, attempts, ms: Date.now() - t0, apiMs: meta.ms ?? null, dataset: dsFile, requestedModel: config.model, model: meta.model ?? null, provider: meta.provider ?? null, usage: meta.usage ?? null };
  const body = res ? { ok: true, ...head, receipt: res.receipt, items: res.items, raw: res.raw }
    : { ok: false, ...head, error: String(err && err.message).slice(0, 300) };
  fs.writeFileSync(file, JSON.stringify(body, null, 1));
  return body.ok ? 'ok' : 'FAILED';
}

(async () => {
  const label = process.argv[2];
  if (!label) throw new Error('缺少 label');
  const extra = process.argv.includes('--extra') ? Number(process.argv[process.argv.indexOf('--extra') + 1]) : 2;
  const onlyArg = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;
  const dsFile = process.argv.includes('--dataset') ? process.argv[process.argv.indexOf('--dataset') + 1] : 'dataset.json';
  const ds = JSON.parse(fs.readFileSync(path.join(root, dsFile), 'utf8'));
  const outDir = path.join(root, 'results', label);
  fs.mkdirSync(outDir, { recursive: true });
  const jobs = [];
  for (const rec of ds.receipts) {
    if (onlyArg && !onlyArg.includes(rec.id)) continue;
    const n = 1 + (VARIABILITY_IDS.includes(rec.id) ? extra : 0);
    for (let run = 1; run <= n; run++) jobs.push([rec, run]);
  }
  console.log(`label=${label} dataset=${dsFile} model=${config.model} jobs=${jobs.length} callsFile=${path.relative(process.cwd(), callsFile)} callsSoFar=${readCalls().total} cap=${HARD_CAP}`);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const [rec, run] = jobs[next++];
      let st;
      try { st = await runJob(label, rec, run, outDir, dsFile); } catch (e) { console.log('STOP', e.message); next = jobs.length; return; }
      console.log(rec.id, run, st);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log('callsTotal=' + readCalls().total);
})();
