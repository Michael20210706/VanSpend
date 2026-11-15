#!/usr/bin/env node
// 只读报告: 最近 N 天里，保存前每个字段被改了多少次、增删了多少明细行、识别耗时与"识别完成到保存"的中位数。
// 数据来自 save_events(只有字段名，没有值)和 scan_log.duration_ms。
// 只发 SELECT，并且整个过程在 READ ONLY 事务里(写语句会被数据库拒绝)。
// 不经过 src/db.cjs: 那个模块一加载就会建表、迁移、种管理员。
//
// 用法(在仓库根目录): node scripts/edit-diff.mjs [--days 30] [--json]
// 连接信息: 环境变量 MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE 优先，
//           缺的从 process.cwd()/.env 补(与 src/db.cjs 同一规则)。
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';

function usage(message) {
  console.error(`${message}\n用法: node scripts/edit-diff.mjs [--days <正整数，默认 30>] [--json]`);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { days: 30, json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') opts.json = true;
    else if (argv[i] === '--days') {
      const raw = argv[++i];
      if (!/^[1-9]\d{0,4}$/.test(raw || '')) usage('--days 必须是正整数');
      opts.days = Number(raw);
    } else usage(`不认识的参数: ${argv[i]}`);
  }
  return opts;
}

function loadDotEnv() {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// events: save_events 的行；scans: scan_log 里有耗时记录的行
function summarize(days, events, scans) {
  const fields = {};
  const editsPerSave = [];
  let itemsAdded = 0;
  let itemsRemoved = 0;
  for (const e of events) {
    const names = JSON.parse(e.edited_fields);
    editsPerSave.push(names.length);
    const seen = new Set();
    for (const name of names) {
      if (name === 'item[+]') { itemsAdded += 1; continue; }
      if (name === 'item[-]') { itemsRemoved += 1; continue; }
      const key = name.replace(/^item\[\d+\]/, 'item'); // 第几行不重要，合并成 item.<列>
      const f = (fields[key] ||= { edits: 0, saves: 0 });
      f.edits += 1;
      if (!seen.has(key)) { seen.add(key); f.saves += 1; }
    }
  }
  const ok = scans.filter((s) => s.success === 1);
  const toSave = events.map((e) => e.scan_to_save_ms).filter((v) => v != null);
  return {
    days,
    saves: events.length,
    savesEdited: editsPerSave.filter((n) => n > 0).length,
    editsPerSaveMedian: median(editsPerSave),
    fields: Object.fromEntries(Object.entries(fields).sort((a, b) => b[1].edits - a[1].edits || a[0].localeCompare(b[0]))),
    itemsAdded,
    itemsRemoved,
    scans: ok.length,
    scansFailed: scans.length - ok.length,
    scanDurationMsMedian: median(ok.map((s) => s.duration_ms)),
    scanToSaveCount: toSave.length,
    scanToSaveMsMedian: median(toSave),
  };
}

function printText(r) {
  const ms = (v) => (v == null ? '无数据' : `${v} ms`);
  console.log(`最近 ${r.days} 天`);
  console.log(`保存事件: ${r.saves} 行，其中 ${r.savesEdited} 行保存前有改动；每次保存改动处数的中位数: ${r.editsPerSaveMedian ?? '无数据'}`);
  const names = Object.keys(r.fields);
  if (names.length) {
    const width = Math.max(...names.map((n) => n.length), 4);
    console.log(`${'字段'.padEnd(width)}  改动次数  涉及保存数`);
    for (const n of names) console.log(`${n.padEnd(width + 2)}  ${String(r.fields[n].edits).padStart(8)}  ${String(r.fields[n].saves).padStart(10)}`);
  }
  console.log(`新增明细行: ${r.itemsAdded}    删除明细行: ${r.itemsRemoved}`);
  console.log(`识别耗时中位数: ${ms(r.scanDurationMsMedian)}(${r.scans} 次成功的识别有耗时记录，另有 ${r.scansFailed} 次失败)`);
  console.log(`识别完成到保存的中位数: ${ms(r.scanToSaveMsMedian)}(${r.scanToSaveCount} 行有记录)`);
}

const opts = parseArgs(process.argv.slice(2));
loadDotEnv();
if (!process.env.MYSQL_DATABASE) usage('没有 MYSQL_DATABASE(环境变量或当前目录的 .env)');

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});
try {
  await conn.query('START TRANSACTION READ ONLY');
  const [events] = await conn.query(
    'SELECT edited_fields, scan_to_save_ms FROM save_events WHERE created_at > NOW() - INTERVAL ? DAY', [opts.days]);
  const [scans] = await conn.query(
    'SELECT success, duration_ms FROM scan_log WHERE duration_ms IS NOT NULL AND created_at > NOW() - INTERVAL ? DAY', [opts.days]);
  const report = summarize(opts.days, events, scans);
  if (opts.json) console.log(JSON.stringify(report, null, 2));
  else printText(report);
} catch (e) {
  if (e.code === 'ER_NO_SUCH_TABLE' || e.code === 'ER_BAD_FIELD_ERROR') {
    console.error('这个库还没有 save_events 表或 scan_log.duration_ms 列(应用升级后启动一次即可自动建好)');
  } else {
    console.error(`查询失败: ${e.message}`);
  }
  process.exitCode = 1;
} finally {
  await conn.end();
}
