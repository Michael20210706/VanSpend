// H-I 事件记录: scan_log.duration_ms + save_events(谁、哪张小票、哪次扫描、改了哪些字段名、AI 条数/保存条数、识别到保存的毫秒数)。
// 只记字段名，绝不记值/品名/金额/图片；保留 90 天，写入时清理；save 接口无 meta 时行为不变。
import fs from 'fs';
import { describe, it, expect, vi, afterEach } from 'vitest';
import dbApi from '@/src/db.cjs';
import openrouterLib from '@/src/openrouter.cjs';
import * as scanRoute from '@/app/api/scan/route.js';
import * as receiptsRoute from '@/app/api/receipts/route.js';
import { makeUser, loginAs, req } from './helpers.js';

const IMG = 'data:image/jpeg;base64,/9j/' + 'A'.repeat(396);
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const AI = { receipt: { store: 'AI店', purchased_at: '2026-05-01', subtotal: 10, gst: 0, pst: 0, total: 10 }, items: [{ name_raw: 'A', category: '其他', qty: 1, amount: 10, taxable: 0 }], raw: {} };
const scan = () => scanRoute.POST(req('/api/scan', { method: 'POST', body: { image: IMG } }));
const body = (o = {}) => ({
  receipt: { store: 'T&T', purchased_at: '2026-05-01', currency: 'CAD', subtotal: 10, gst: 0.5, pst: 0.7, total: 11.2 },
  items: [{ name_raw: 'Milk', name_norm: 'milk', category: '食品杂货', subcategory: null, qty: 1, unit: null, unit_price: 10, amount: 10, taxable: 1 }],
  ...o,
});
const save = (b) => receiptsRoute.POST(req('/api/receipts', { method: 'POST', body: b }));
const events = async (userId) => (await dbApi.pool.query('SELECT * FROM save_events WHERE user_id = ? ORDER BY id', [userId]))[0];
const scanRow = async (id) => (await dbApi.pool.query('SELECT * FROM scan_log WHERE id = ?', [id]))[0][0];
const files = () => fs.readdirSync(process.env.UPLOAD_DIR).length;
const receiptCount = async (userId) => (await dbApi.pool.execute('SELECT COUNT(*) c FROM receipts WHERE user_id = :uid', { uid: userId }))[0][0].c;

afterEach(() => vi.restoreAllMocks());

describe('升级迁移: scan_log.duration_ms 与 save_events 表', () => {
  const cols = async (t) => (await dbApi.pool.query(
    'SELECT COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [t]))[0].map((r) => r.c);
  const EVENT_COLS = ['id', 'user_id', 'receipt_id', 'scan_log_id', 'edited_fields', 'items_ai', 'items_saved', 'scan_to_save_ms', 'created_at'];

  it('旧库(没有这一列、没有这张表)→ 启动时的 initSchema 补齐；再跑一次是空操作；老的 scan_log 行不丢、耗时为 NULL', async () => {
    const u = await makeUser();
    const slot = await dbApi.reserveScan(u.id, 'm', null);
    await dbApi.finishScan(slot.id, true);
    await dbApi.pool.query('DROP TABLE save_events');
    await dbApi.pool.query('ALTER TABLE scan_log DROP COLUMN duration_ms');
    expect(await cols('scan_log')).not.toContain('duration_ms');
    expect(await cols('save_events')).toEqual([]);

    await dbApi.initSchema();
    await dbApi.initSchema();

    expect(await cols('scan_log')).toContain('duration_ms');
    expect((await cols('save_events')).sort()).toEqual([...EVENT_COLS].sort());
    expect(await scanRow(slot.id)).toMatchObject({ user_id: u.id, model: 'm', success: 1, duration_ms: null });
  });

  it('migrateScanLogDuration 只加列: 没有就加，已有就什么都不做', async () => {
    await dbApi.pool.query('ALTER TABLE scan_log DROP COLUMN duration_ms');
    const before = (await cols('scan_log')).sort();
    const conn = await dbApi.pool.getConnection();
    try {
      await dbApi.migrateScanLogDuration(conn);
      await dbApi.migrateScanLogDuration(conn);
    } finally {
      conn.release();
    }
    expect((await cols('scan_log')).sort()).toEqual([...before, 'duration_ms'].sort());
  });
});

describe('POST /api/scan 返回 scanId 并记录耗时', () => {
  it('成功: 响应多出 scanId(= scan_log.id)，其余字段不变；duration_ms 被写入', async () => {
    vi.spyOn(openrouterLib, 'scanReceipt').mockImplementation(() => new Promise((r) => setTimeout(() => r(AI), 30)));
    const u = await makeUser();
    await loginAs(u);
    const res = await scan();
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j).toEqual({ ...AI, scanId: expect.any(Number) });
    const row = await scanRow(j.scanId);
    expect(row.user_id).toBe(u.id);
    expect(row.success).toBe(1);
    expect(row.duration_ms).toBeGreaterThanOrEqual(25);
    expect(row.duration_ms).toBeLessThan(10000);
  });

  it('失败: 仍 502、不透出上游报错、没有 scanId，duration_ms 也写入', async () => {
    vi.spyOn(openrouterLib, 'scanReceipt').mockRejectedValue(new Error('upstream secret'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const u = await makeUser();
    await loginAs(u);
    const res = await scan();
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toMatch(/upstream secret/);
    expect(text).not.toMatch(/scanId/);
    const [row] = (await dbApi.pool.query('SELECT * FROM scan_log WHERE user_id = ?', [u.id]))[0];
    expect(row.success).toBe(0);
    expect(typeof row.duration_ms).toBe('number');
  });
});

describe('POST /api/receipts 的 meta', () => {
  it('没有 meta(缺省或 null): 保存照旧，响应只有 { id }，不写 save_events', async () => {
    const u = await makeUser();
    await loginAs(u);
    for (const b of [body(), body({ meta: null })]) {
      const res = await save(b);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ id: expect.any(Number) });
    }
    expect(await receiptCount(u.id)).toBe(2);
    expect(await events(u.id)).toHaveLength(0);
  });

  it('带 meta: 响应仍只有 { id }；写一行，scan_log_id 指向自己的扫描，字段名/条数/毫秒数原样记录', async () => {
    const u = await makeUser();
    const slot = await dbApi.reserveScan(u.id, 'm', null);
    await loginAs(u);
    const editedFields = ['receipt.store', 'receipt.purchased_at', 'item[0].amount', 'item[299].subcategory', 'item[+]', 'item[+]', 'item[-]'];
    const res = await save(body({ meta: { scanId: slot.id, editedFields, itemsAi: 2, scanToSaveMs: 4321 } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ id: expect.any(Number) });
    const rows = await events(u.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: u.id, receipt_id: json.id, scan_log_id: slot.id, items_ai: 2, items_saved: 1, scan_to_save_ms: 4321 });
    expect(JSON.parse(rows[0].edited_fields)).toEqual(editedFields);
  });

  it('scanId 是别人的扫描或不存在 → 仍写一行，但 scan_log_id 为 NULL', async () => {
    const other = await makeUser();
    const slot = await dbApi.reserveScan(other.id, 'm', null);
    const u = await makeUser();
    await loginAs(u);
    expect((await save(body({ meta: { scanId: slot.id, editedFields: [] } }))).status).toBe(200);
    expect((await save(body({ meta: { scanId: 999999999, editedFields: [] } }))).status).toBe(200);
    const rows = await events(u.id);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.scan_log_id)).toEqual([null, null]);
    expect(await events(other.id)).toHaveLength(0);
  });

  it('没有扫描的保存(scanId/itemsAi/scanToSaveMs 缺省或 null)→ 一行，这三列为 NULL', async () => {
    const u = await makeUser();
    await loginAs(u);
    expect((await save(body({ meta: { editedFields: ['receipt.total'] } }))).status).toBe(200);
    expect((await save(body({ meta: { editedFields: [], scanId: null, itemsAi: null, scanToSaveMs: null } }))).status).toBe(200);
    const rows = await events(u.id);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row).toMatchObject({ scan_log_id: null, items_ai: null, scan_to_save_ms: null, items_saved: 1 });
    expect(JSON.parse(rows[0].edited_fields)).toEqual(['receipt.total']);
  });

  it('meta 里不认识的键被忽略(不入库)，边界值可以通过', async () => {
    const u = await makeUser();
    await loginAs(u);
    const meta = { editedFields: Array(1000).fill('item[-]'), itemsAi: 0, scanToSaveMs: 2 ** 31 - 1, note: 'ZQXSENTINEL', store: 'ZQXSENTINEL' };
    expect((await save(body({ meta }))).status).toBe(200);
    const [row] = await events(u.id);
    expect(row).toMatchObject({ items_ai: 0, scan_to_save_ms: 2 ** 31 - 1 });
    expect(JSON.parse(row.edited_fields)).toHaveLength(1000);
    expect(JSON.stringify(row)).not.toContain('ZQXSENTINEL');
  });

  // 除了"meta 本身形状不对"的几条，其余每条都只有被测的那个字段不合法(editedFields 给合法的空数组)
  const ok = { editedFields: [] };
  const bad = {
    'meta 是数组': [],
    'meta 是字符串': 'x',
    'meta 是数字': 1,
    'meta 缺 editedFields': {},
    'scanId 是字符串': { ...ok, scanId: '12' },
    'scanId 是 0': { ...ok, scanId: 0 },
    'scanId 是负数': { ...ok, scanId: -1 },
    'scanId 是小数': { ...ok, scanId: 1.5 },
    'scanId 超出安全整数': { ...ok, scanId: 2 ** 53 },
    'editedFields 不是数组': { editedFields: 'receipt.store' },
    'editedFields 含非字符串': { editedFields: [1] },
    'editedFields 含数组': { editedFields: [['receipt.store']] },
    'editedFields 字段名后面带值': { editedFields: ['receipt.store=Costco'] },
    'editedFields 字段名前面带东西': { editedFields: ['x receipt.store'] },
    'editedFields 带换行再接别的内容': { editedFields: ['receipt.store\nCostco 12.34'] },
    'editedFields 含未知的小票字段': { editedFields: ['receipt.password'] },
    'editedFields 含不可编辑的 currency': { editedFields: ['receipt.currency'] },
    'editedFields 含未知的明细字段': { editedFields: ['item[0].secret'] },
    'editedFields 明细下标 4 位数': { editedFields: ['item[1000].amount'] },
    'editedFields 明细下标不是数字': { editedFields: ['item[Milk].amount'] },
    'editedFields 明细没有字段名': { editedFields: ['item[0]'] },
    'editedFields item[+] 后面带字段': { editedFields: ['item[+].amount'] },
    'editedFields 空字符串': { editedFields: [''] },
    'editedFields 超过 1000 个': { editedFields: Array(1001).fill('receipt.store') },
    'itemsAi 负数': { ...ok, itemsAi: -1 },
    'itemsAi 字符串': { ...ok, itemsAi: '2' },
    'itemsAi 小数': { ...ok, itemsAi: 1.5 },
    'itemsAi 超过 32 位': { ...ok, itemsAi: 2 ** 31 },
    'scanToSaveMs 负数': { ...ok, scanToSaveMs: -5 },
    'scanToSaveMs 字符串': { ...ok, scanToSaveMs: '5' },
    'scanToSaveMs 超过 32 位': { ...ok, scanToSaveMs: 2 ** 31 },
  };
  for (const [name, meta] of Object.entries(bad)) {
    it(`非法 meta(${name})→ 400，不入库、不落盘、不写事件`, async () => {
      const u = await makeUser();
      await loginAs(u);
      const before = files();
      const res = await save(body({ meta, image: PNG }));
      expect(res.status).toBe(400);
      expect(typeof (await res.json()).error).toBe('string');
      expect(await receiptCount(u.id)).toBe(0);
      expect(files()).toBe(before);
      expect(await events(u.id)).toHaveLength(0);
    });
  }

  it('事件写入失败不影响保存(记日志、照样 200、小票已入库)', async () => {
    vi.spyOn(dbApi, 'recordSaveEvent').mockRejectedValue(new Error('db gone'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const u = await makeUser();
    await loginAs(u);
    const res = await save(body({ meta: { editedFields: [] } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: expect.any(Number) });
    expect(await receiptCount(u.id)).toBe(1);
    expect(err).toHaveBeenCalled();
  });
});

describe('隐私: save_events 任何列都不含值', () => {
  it('商家、品名、规范名、细分、单位、金额、原图里的哨兵串，都不出现在事件行里', async () => {
    const S = 'ZQXSENTINEL';
    const u = await makeUser();
    await loginAs(u);
    const b = body();
    b.receipt.store = `${S}-store`;
    b.receipt.total = 4242.42;
    b.receipt.subtotal = 4242.42;
    b.items[0] = { ...b.items[0], name_raw: `${S}-raw`, name_norm: `${S}-norm`, subcategory: `${S}-sub`, unit: `${S}-unit`, amount: 4242.42, unit_price: 4242.42 };
    b.image = PNG;
    b.raw = { note: `${S}-raw-json` };
    b.meta = { editedFields: ['receipt.store', 'item[0].name_raw', 'item[0].amount'], itemsAi: 1, scanToSaveMs: 10 };
    expect((await save(b)).status).toBe(200);
    const [[receipt]] = await dbApi.pool.query('SELECT store, image_file FROM receipts WHERE user_id = ?', [u.id]);
    expect(receipt.store).toBe(`${S}-store`);
    const [row] = await events(u.id);
    expect(Object.keys(row).sort()).toEqual(['created_at', 'edited_fields', 'id', 'items_ai', 'items_saved', 'receipt_id', 'scan_log_id', 'scan_to_save_ms', 'user_id']);
    const dump = JSON.stringify(row);
    expect(dump).not.toContain(S);
    expect(dump).not.toContain('4242');
    expect(dump).not.toContain('base64');
    expect(dump).not.toContain(receipt.image_file);
    expect(dump).not.toContain(u.username);
  });

  it('editedFields 里塞值 → 400(字段名语法不允许)，什么都不写', async () => {
    const u = await makeUser();
    await loginAs(u);
    expect((await save(body({ meta: { editedFields: ['ZQXSENTINEL'] } }))).status).toBe(400);
    expect(await events(u.id)).toHaveLength(0);
    expect(await receiptCount(u.id)).toBe(0);
  });
});

describe('保留与级联', () => {
  it('写入时清掉 90 天前的行，89 天前的留下', async () => {
    const u = await makeUser();
    const old = await makeUser();
    await dbApi.pool.execute("INSERT INTO save_events (user_id, edited_fields, items_saved, created_at) VALUES (?, '[]', 1, NOW() - INTERVAL 91 DAY)", [old.id]);
    await dbApi.pool.execute("INSERT INTO save_events (user_id, edited_fields, items_saved, created_at) VALUES (?, '[]', 1, NOW() - INTERVAL 89 DAY)", [old.id]);
    expect(await events(old.id)).toHaveLength(2);
    await loginAs(u);
    expect((await save(body({ meta: { editedFields: [] } }))).status).toBe(200);
    const [[kept]] = await dbApi.pool.query('SELECT COUNT(*) n, MIN(created_at) < NOW() - INTERVAL 88 DAY AS is89 FROM save_events WHERE user_id = ?', [old.id]);
    expect(kept).toEqual({ n: 1, is89: 1 });
    expect(await events(u.id)).toHaveLength(1);
  });

  it('没有 meta 的保存不碰 save_events(只有写事件时才清理)', async () => {
    const u = await makeUser();
    await dbApi.pool.execute("INSERT INTO save_events (user_id, edited_fields, items_saved, created_at) VALUES (?, '[]', 1, NOW() - INTERVAL 91 DAY)", [u.id]);
    await loginAs(u);
    expect((await save(body())).status).toBe(200);
    expect(await events(u.id)).toHaveLength(1);
    await dbApi.pool.query('DELETE FROM save_events WHERE user_id = ?', [u.id]);
  });

  it('删小票 → 事件留下、receipt_id 置空；删 scan_log → scan_log_id 置空', async () => {
    const u = await makeUser();
    const slot = await dbApi.reserveScan(u.id, 'm', null);
    await loginAs(u);
    const { id } = await (await save(body({ meta: { scanId: slot.id, editedFields: [] } }))).json();
    expect((await events(u.id))[0]).toMatchObject({ receipt_id: id, scan_log_id: slot.id });
    await dbApi.deleteReceipt(id, u.id);
    await dbApi.pool.query('DELETE FROM scan_log WHERE id = ?', [slot.id]);
    const [row] = await events(u.id);
    expect(row).toMatchObject({ receipt_id: null, scan_log_id: null });
  });

  it('删账号(小票、扫描记录、事件都还在)→ 事件随账号级联删除，不报错', async () => {
    const u = await makeUser();
    const slot = await dbApi.reserveScan(u.id, 'm', null);
    await loginAs(u);
    expect((await save(body({ meta: { scanId: slot.id, editedFields: ['receipt.store'] } }))).status).toBe(200);
    expect(await events(u.id)).toHaveLength(1);
    expect(await dbApi.deleteUser(u.id)).toBe(1);
    expect(await events(u.id)).toHaveLength(0);
  });
});
