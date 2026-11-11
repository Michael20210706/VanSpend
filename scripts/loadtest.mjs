#!/usr/bin/env node
// VanSpend 压测脚本: 固定并发的闭环负载生成器，只用 Node 内置 fetch。
// 只对你自己启动的一次性实例使用(不要对线上、不要对真实库)。
//
// 用法:
//   LOAD_PASSWORD=... node scripts/loadtest.mjs run S1 --levels 10,50,100,200
//   node scripts/loadtest.mjs run S3b --levels 20 --duration 20
//   node scripts/loadtest.mjs soak --scenario S1 --level 50 --minutes 5
// 环境变量:
//   BASE            目标，默认 http://127.0.0.1:3300
//   LOAD_USER_PREFIX 预置用户名前缀，默认 stress (stress01..stress20)
//   LOAD_USERS      用户数，默认 20
//   LOAD_PASSWORD   预置用户的统一密码(必填，不写进脚本)
//   SERVER_PID      目标 Node 进程 pid(采样 CPU/RSS)；不设则不采样
//   MYSQL_CONTAINER MySQL 容器名(采样 docker stats / 连接数)；不设则不采样
//   PROBE           负载期间并行探测的路径(顺序、约 10 次/秒)，默认 /api/auth/me
//   OUT             结果 JSONL 路径，默认 ./loadtest-results.jsonl
// 场景: S1 读混合 | S2 写 | S3 正确密码登录 | S3b 同一用户名错误密码(锁定) | S4 匿名廉价接口 | S5 混合 80/15/5
import { execFile } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { monitorEventLoopDelay } from 'node:perf_hooks';

const BASE = process.env.BASE || 'http://127.0.0.1:3300';
const PREFIX = process.env.LOAD_USER_PREFIX || 'stress';
const NUSERS = Number(process.env.LOAD_USERS || 20);
const PASSWORD = process.env.LOAD_PASSWORD;
const SERVER_PID = process.env.SERVER_PID;
const MYSQL = process.env.MYSQL_CONTAINER;
const PROBE = process.env.PROBE || '/api/auth/me';
const OUT = process.env.OUT || './loadtest-results.jsonl';
const TIMEOUT_MS = 30000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uname = (i) => `${PREFIX}${String((i % NUSERS) + 1).padStart(2, '0')}`;
const randIp = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${1 + ((Math.random() * 250) | 0)}`;

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };

// ---------- 请求与记录 ----------
class Recorder {
  constructor() { this.lat = []; this.err = {}; this.bodies = {}; this.ok = 0; }
  add(ms, status, kind, body) {
    if (kind) { this.err[kind] = (this.err[kind] || 0) + 1; }
    else if (status >= 200 && status < 300) { this.ok++; this.lat.push(ms); return; }
    else { const k = 'http' + status; this.err[k] = (this.err[k] || 0) + 1; kind = k; }
    // 429 在锁定场景是预期结果，延迟也单独记，放在 lat429
    (this['lat_' + kind] ||= []).push(ms);
    if (kind && /^http5/.test(kind) && body !== undefined) {
      const arr = (this.bodies[kind] ||= []);
      if (arr.length < 3 && !arr.includes(body)) arr.push(body);
    }
  }
}
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : null);
const summarize = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  const r = (x) => (x == null ? null : +x.toFixed(1));
  return { n: s.length, p50: r(pct(s, 50)), p90: r(pct(s, 90)), p99: r(pct(s, 99)), max: r(s[s.length - 1]) };
};

async function call(rec, method, path, { cookie, body, ip } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (ip) headers['x-forwarded-for'] = ip;
  const t0 = performance.now();
  try {
    const res = await fetch(BASE + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    rec.add(performance.now() - t0, res.status, null, text.slice(0, 300));
    return res.status;
  } catch (e) {
    const code = (e.cause && e.cause.code) || e.name || 'error';
    rec.add(performance.now() - t0, 0, code === 'TimeoutError' ? 'timeout' : 'net_' + code);
    return 0;
  }
}

async function login(username, password, ip) {
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip || randIp() },
    body: JSON.stringify({ username, password }),
  });
  await res.text();
  if (res.status !== 200) throw new Error(`login ${username} -> ${res.status}`);
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

// ---------- 负载内容 ----------
const STORES = ['Costco', 'T&T', 'Save-On-Foods', 'Walmart', 'London Drugs', 'IKEA'];
const CATS = ['食品杂货', '餐饮', '日用品', '其他'];
function receiptBody(seed) {
  const n = 3 + (seed % 3);
  const items = Array.from({ length: n }, (_, k) => ({
    name_raw: `Item ${seed}-${k}`, name_norm: `item ${k}`, category: CATS[k % CATS.length], subcategory: null,
    qty: 1, unit: null, unit_price: 2.5 + k, amount: 2.5 + k, taxable: 1,
  }));
  const subtotal = +items.reduce((a, i) => a + i.amount, 0).toFixed(2);
  const gst = +(subtotal * 0.05).toFixed(2), pst = +(subtotal * 0.07).toFixed(2);
  const d = new Date(Date.UTC(2026, 0, 1) + (seed % 300) * 86400000).toISOString().slice(0, 10);
  const receipt = { store: STORES[seed % STORES.length], purchased_at: d, currency: 'CAD', subtotal, gst, pst, total: +(subtotal + gst + pst).toFixed(2) };
  return { receipt, items, raw: { receipt, items } };
}
const READS = ['/api/receipts', '/api/stats/overview', '/api/stats/category', '/api/stats/monthly'];

// 每个场景返回 (workerIdx, state) => async op；state.cookie 是该 worker 的会话
function makeOp(scn, rec, ctx) {
  let seq = 0;
  const read = (w, st) => call(rec, 'GET', READS[(st.n++ + w) % READS.length], { cookie: st.cookie });
  const write = (w, st) => call(rec, 'POST', '/api/receipts', { cookie: st.cookie, body: receiptBody(ctx.next++) });
  const loginOk = (w, st) => call(rec, 'POST', '/api/auth/login', { body: { username: uname(w), password: PASSWORD }, ip: randIp() });
  switch (scn) {
    case 'S1': return read;
    case 'S2': return write;
    case 'S3': return loginOk;
    case 'S3b': return (w, st) => call(rec, 'POST', '/api/auth/login', { body: { username: `${PREFIX}${String(NUSERS).padStart(2, '0')}`, password: 'wrong-password-x' }, ip: randIp() });
    case 'S4': return (w, st) => call(rec, 'GET', (seq++ % 2 ? '/api/auth/captcha' : '/api/auth/me'));
    case 'S5': return (w, st) => { const r = Math.random(); return r < 0.8 ? read(w, st) : r < 0.95 ? write(w, st) : loginOk(w, st); };
    default: throw new Error('unknown scenario ' + scn);
  }
}
// S3b 的探测用别的用户的读请求，看连接池有没有被占满

// ---------- 采样 ----------
const sh = (cmd, a) => new Promise((res) => execFile(cmd, a, { timeout: 15000 }, (e, out) => res(e ? '' : out)));
async function sampleOnce() {
  const s = { t: Date.now() };
  const jobs = [];
  if (SERVER_PID) jobs.push(sh('ps', ['-o', '%cpu=,rss=', '-p', SERVER_PID]).then((o) => { const [c, r] = o.trim().split(/\s+/); s.node_cpu = +c; s.node_rss_mb = +(r / 1024).toFixed(0); }));
  jobs.push(sh('ps', ['-o', '%cpu=,rss=', '-p', String(process.pid)]).then((o) => { const [c, r] = o.trim().split(/\s+/); s.gen_cpu = +c; s.gen_rss_mb = +(r / 1024).toFixed(0); }));
  if (MYSQL) {
    jobs.push(sh('docker', ['stats', '--no-stream', '--format', '{{.CPUPerc}} {{.MemUsage}}', MYSQL]).then((o) => { s.mysql_docker = o.trim(); }));
    jobs.push(sh('docker', ['exec', MYSQL, 'sh', '-c',
      `mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -N -e "SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_connected','Threads_running','Max_used_connections'); SELECT COUNT(*) FROM information_schema.processlist" 2>/dev/null`])
      .then((o) => { const l = o.trim().split('\n'); for (const x of l.slice(0, 3)) { const [k, v] = x.split('\t'); s[k] = +v; } s.processlist = +l[3]; }));
  }
  await Promise.all(jobs);
  return s;
}

// ---------- 一个水平 ----------
async function runLevel({ scn, conc, duration, warmup, cookies, label }) {
  let phase = 'warm';
  const recs = { warm: new Recorder(), run: new Recorder() };
  const probeRec = new Recorder();
  const ctx = { next: Math.floor(Math.random() * 1e6) };
  const op = makeOp(scn, new Proxy({}, { get(_, k) { return (...a) => recs[phase][k](...a); } }), ctx);
  let stop = false;
  const eld = monitorEventLoopDelay({ resolution: 5 }); eld.enable();
  const probeEnabled = !!PROBE && label !== 'baseline';
  let probeActive = false;

  const workers = Array.from({ length: conc }, (_, w) => (async () => {
    const st = { n: 0, cookie: cookies[w % cookies.length] };
    while (!stop) await op(w, st);
  })());
  const probe = (async () => {
    // 探测永远用 S1 之外的另一个用户的会话: 对 /api/auth/me 它会触发一次主键查询(getSessionUser)
    while (!stop) { if (probeActive && probeEnabled) await call(probeRec, 'GET', PROBE, { cookie: cookies[0] || undefined }); await sleep(100); }
  })();

  await sleep(warmup * 1000);
  phase = 'run';
  probeActive = true;
  const cpu0 = process.cpuUsage(); const t0 = performance.now(); eld.reset();
  const samples = [];
  const sampler = (async () => { while (!stop) { samples.push(await sampleOnce()); await sleep(4000); } })();
  await sleep(duration * 1000);
  const wall = (performance.now() - t0) / 1000;
  const cpu = process.cpuUsage(cpu0);
  const eldSnap = { p50: eld.percentile(50) / 1e6, p99: eld.percentile(99) / 1e6, max: eld.max / 1e6 };
  stop = true; probeActive = false; eld.disable();
  await Promise.all(workers); await probe; await sampler;

  const r = recs.run;
  const total = r.ok + Object.values(r.err).reduce((a, b) => a + b, 0);
  const out = {
    scenario: scn, label: label || 'level', concurrency: conc, duration_s: +wall.toFixed(1),
    requests: total, throughput_rps: +(total / wall).toFixed(1), ok_rps: +(r.ok / wall).toFixed(1),
    error_rate: +(((total - r.ok) / Math.max(1, total)) * 100).toFixed(2), errors: r.err,
    latency_ok_ms: summarize(r.lat),
    latency_by_error_ms: Object.fromEntries(Object.keys(r.err).map((k) => [k, summarize(r['lat_' + k] || [])])),
    server_5xx_bodies: r.bodies,
    probe_ms: probeRec.lat.length ? summarize(probeRec.lat) : null,
    generator: { cpu_pct_of_core: +(((cpu.user + cpu.system) / 1000 / (wall * 1000)) * 100).toFixed(0), eld_p50_ms: +eldSnap.p50.toFixed(1), eld_p99_ms: +eldSnap.p99.toFixed(1), eld_max_ms: +eldSnap.max.toFixed(1) },
    samples,
  };
  return out;
}

async function getCookies(scn) {
  if (!PASSWORD) throw new Error('LOAD_PASSWORD 未设置');
  // 每个用户登录一次(各用不同的伪造来源 IP，避免按 IP 的失败计数)
  const c = [];
  for (let i = 0; i < NUSERS - 1; i++) c.push(await login(uname(i), PASSWORD, randIp())); // 最后一个用户留给锁定测试
  return c;
}

function printLine(o) {
  const l = o.latency_ok_ms;
  console.log(`${o.scenario} ${o.label} c=${o.concurrency} rps=${o.throughput_rps} err=${o.error_rate}% ${JSON.stringify(o.errors)} p50=${l.p50} p90=${l.p90} p99=${l.p99} max=${l.max} probe=${o.probe_ms ? o.probe_ms.p50 + '/' + o.probe_ms.p99 : '-'} genCPU=${o.generator.cpu_pct_of_core}% genELDp99=${o.generator.eld_p99_ms}`);
}
const save = (o) => appendFileSync(OUT, JSON.stringify(o) + '\n');

async function main() {
  const cmd = args[0];
  if (cmd === 'run') {
    const scn = args[1];
    const levels = opt('levels', '10,50,100,200').split(',').map(Number);
    const duration = Number(opt('duration', 60)), warmup = Number(opt('warmup', 10)), recovery = Number(opt('recovery', 20));
    const cookies = await getCookies(scn);
    const bcookies = cookies;
    const runBaseline = async (tag) => {
      const o = await runLevel({ scn: scn === 'S3' || scn === 'S3b' ? 'S1' : scn, conc: 1, duration: 5, warmup: 2, cookies: bcookies, label: 'baseline' });
      o.label = 'baseline-' + tag; save(o); printLine(o); return o;
    };
    if (opt('baseline', '1') === '1') await runBaseline('before');
    for (const conc of levels) {
      const o = await runLevel({ scn, conc, duration, warmup, cookies });
      save(o); printLine(o);
      await sleep(recovery * 1000);
      if (opt('baseline', '1') === '1') await runBaseline('after-c' + conc);
    }
  } else if (cmd === 'seed') {
    // 通过应用自己的 POST /api/receipts 给每个预置用户写 N 条小票(并发 8)
    const per = Number(opt('per', 200));
    const cookies = await getCookies('S2'); const rec = new Recorder(); let k = 0;
    const jobs = []; for (let u = 0; u < cookies.length; u++) for (let i = 0; i < per; i++) jobs.push([u, k++]);
    await Promise.all(Array.from({ length: 8 }, async () => { for (let j; (j = jobs.shift());) await call(rec, 'POST', '/api/receipts', { cookie: cookies[j[0]], body: receiptBody(j[1]) }); }));
    console.log('seeded ok=%d err=%j users=%d', rec.ok, rec.err, cookies.length);
  } else if (cmd === 'soak') {
    const scn = opt('scenario', 'S1'), conc = Number(opt('level', 50)), minutes = Number(opt('minutes', 5));
    const cookies = await getCookies(scn);
    const o = await runLevel({ scn, conc, duration: minutes * 60, warmup: 10, cookies, label: 'soak' });
    save(o); printLine(o);
    const f = o.samples.filter((s) => s.node_rss_mb); console.log('node RSS MB start/end:', f[0]?.node_rss_mb, f[f.length - 1]?.node_rss_mb);
  } else {
    console.error('usage: loadtest.mjs run <S1|S2|S3|S3b|S4|S5> [--levels a,b] [--duration 60 --warmup 10 --recovery 20] | soak [--scenario S1 --level 50 --minutes 5]');
    process.exit(2);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
