// scripts/edit-diff.mjs: 只读报告(每个字段被改了多少次、增删了多少行、识别耗时与识别到保存的中位数)。
// 以子进程方式对测试库真实运行；脚本自己连库(不经过 src/db.cjs，所以不会触发建表/迁移/种管理员)。
import { execFileSync } from 'child_process';
import { describe, it, expect } from 'vitest';
import dbApi from '@/src/db.cjs';
import { makeUser } from './helpers.js';

describe('scripts/edit-diff.mjs(只读报告)', () => {
  const run = (...args) => execFileSync(process.execPath, ['scripts/edit-diff.mjs', ...args], { env: process.env, encoding: 'utf8', stdio: 'pipe' });
  const tableCounts = async () => {
    const [tables] = await dbApi.pool.query('SELECT TABLE_NAME t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME');
    const out = {};
    for (const { t } of tables) out[t] = (await dbApi.pool.query(`SELECT COUNT(*) n FROM \`${t}\``))[0][0].n;
    return out;
  };
  const addEvent = (userId, fields, { itemsAi = null, itemsSaved = 1, ms = null, daysAgo = 0 } = {}) => dbApi.pool.query(
    'INSERT INTO save_events (user_id, edited_fields, items_ai, items_saved, scan_to_save_ms, created_at) VALUES (?, ?, ?, ?, ?, NOW() - INTERVAL ? DAY)',
    [userId, JSON.stringify(fields), itemsAi, itemsSaved, ms, daysAgo]);
  const addScan = (userId, success, durationMs, daysAgo = 0) => dbApi.pool.query(
    'INSERT INTO scan_log (user_id, model, success, duration_ms, created_at) VALUES (?, ?, ?, ?, NOW() - INTERVAL ? DAY)', [userId, 'm', success, durationMs, daysAgo]);

  it('空库: 输出"0 行"，退出码 0', async () => {
    await dbApi.pool.query('DELETE FROM save_events');
    expect(run()).toContain('0 行');
    expect(JSON.parse(run('--json'))).toMatchObject({
      days: 30, saves: 0, fields: {}, itemsAdded: 0, itemsRemoved: 0, scans: 0, scanDurationMsMedian: null, scanToSaveMsMedian: null,
    });
  });

  it('有数据: 按字段统计改动次数、增删行数、两个中位数；--days 只看窗口内；不写任何表', async () => {
    await dbApi.pool.query('DELETE FROM save_events');
    const u = await makeUser();
    await addEvent(u.id, ['receipt.store', 'item[0].amount', 'item[3].amount', 'item[+]'], { itemsAi: 4, itemsSaved: 5, ms: 1000 });
    await addEvent(u.id, ['item[1].amount', 'item[-]', 'item[-]'], { itemsAi: 3, itemsSaved: 1, ms: 3000 });
    await addEvent(u.id, [], { itemsAi: 2, itemsSaved: 2, ms: 8000 });
    await addEvent(u.id, ['receipt.total'], { daysAgo: 10 });
    await addScan(u.id, 1, 100);
    await addScan(u.id, 1, 300);
    await addScan(u.id, 1, 1100);
    await addScan(u.id, 0, 99999);
    await addScan(u.id, 1, null);
    await addScan(u.id, 1, 5, 10);
    const before = await tableCounts();
    expect(before.save_events).toBe(4);

    const all = JSON.parse(run('--json'));
    expect(all).toMatchObject({
      days: 30, saves: 4, savesEdited: 3, editsPerSaveMedian: 2,
      itemsAdded: 1, itemsRemoved: 2,
      scans: 4, scansFailed: 1, scanDurationMsMedian: 200,
      scanToSaveMsMedian: 3000,
    });
    expect(all.fields).toEqual({
      'item.amount': { edits: 3, saves: 2 },
      'receipt.store': { edits: 1, saves: 1 },
      'receipt.total': { edits: 1, saves: 1 },
    });

    const week = JSON.parse(run('--json', '--days', '7'));
    expect(week).toMatchObject({ days: 7, saves: 3, scans: 3, scanDurationMsMedian: 300 });
    expect(week.fields['receipt.total']).toBeUndefined();

    const text = run('--days', '7');
    expect(text).toContain('3 行');
    expect(text).toContain('item.amount');
    expect(text).not.toContain('receipt.total');

    expect(await tableCounts()).toEqual(before);
    await dbApi.pool.query('DELETE FROM save_events');
  });

  it('--days 不是正整数 → 退出码 2，提示用法', () => {
    for (const bad of ['abc', '0', '-3', '1.5']) {
      let err;
      try { run('--days', bad); } catch (e) { err = e; }
      expect(err?.status).toBe(2);
      expect(err.stderr).toContain('--days');
    }
  });
});
