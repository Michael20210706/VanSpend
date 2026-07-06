'use strict';

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite'); // Node 22.5+ 内置，无需编译

const DATA_DIR = process.env.VANSPEND_DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'vanspend.sqlite'));
// WAL 在网络盘/云同步盘上可能失败，失败则回退默认模式
try { db.exec('PRAGMA journal_mode = WAL'); } catch (_) { /* 回退 rollback journal */ }
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS receipts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  store         TEXT    NOT NULL DEFAULT '未知',
  purchased_at  TEXT    NOT NULL,            -- YYYY-MM-DD
  currency      TEXT    NOT NULL DEFAULT 'CAD',
  subtotal      REAL    NOT NULL DEFAULT 0,  -- 税前合计
  gst           REAL    NOT NULL DEFAULT 0,
  pst           REAL    NOT NULL DEFAULT 0,
  total         REAL    NOT NULL DEFAULT 0,  -- 实付总额
  image_file    TEXT,
  raw_json      TEXT,                        -- 模型原始返回，便于复核/纠错
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id    INTEGER NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  name_raw      TEXT    NOT NULL,            -- 小票原文(可能是缩写/中文)
  name_norm     TEXT,                        -- 规范化品名，用于跨时间比价
  category      TEXT    NOT NULL DEFAULT '其他',
  subcategory   TEXT,                        -- 细分: 牛肉/猪肉/鸡肉/三文鱼...
  qty           REAL    NOT NULL DEFAULT 1,
  unit          TEXT,                        -- 单位: 个/kg/lb/包
  unit_price    REAL,                        -- 单价(原币)
  amount        REAL    NOT NULL DEFAULT 0,  -- 该行小计(税前)
  taxable       INTEGER NOT NULL DEFAULT 0,  -- 是否计税 0/1
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_items_receipt   ON items(receipt_id);
CREATE INDEX IF NOT EXISTS idx_items_category  ON items(category);
CREATE INDEX IF NOT EXISTS idx_items_subcat    ON items(subcategory);
CREATE INDEX IF NOT EXISTS idx_items_norm      ON items(name_norm);
CREATE INDEX IF NOT EXISTS idx_receipts_date   ON receipts(purchased_at);
`);

// ---- 写入 ----
const insertReceiptStmt = db.prepare(`
  INSERT INTO receipts (store, purchased_at, currency, subtotal, gst, pst, total, image_file, raw_json)
  VALUES (@store, @purchased_at, @currency, @subtotal, @gst, @pst, @total, @image_file, @raw_json)
`);
const insertItemStmt = db.prepare(`
  INSERT INTO items (receipt_id, name_raw, name_norm, category, subcategory, qty, unit, unit_price, amount, taxable)
  VALUES (@receipt_id, @name_raw, @name_norm, @category, @subcategory, @qty, @unit, @unit_price, @amount, @taxable)
`);

function saveReceipt(receipt, items) {
  db.exec('BEGIN');
  try {
    const info = insertReceiptStmt.run(receipt);
    const rid = Number(info.lastInsertRowid);
    for (const it of items) {
      insertItemStmt.run({ ...it, receipt_id: rid });
    }
    db.exec('COMMIT');
    return rid;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// ---- 查询 ----
function dateFilter(from, to) {
  const clauses = [];
  const params = {};
  if (from) { clauses.push('r.purchased_at >= @from'); params.from = from; }
  if (to)   { clauses.push('r.purchased_at <= @to');   params.to = to; }
  return { where: clauses.length ? 'WHERE ' + clauses.join(' AND ') : '', params };
}

function listReceipts(limit = 200) {
  return db.prepare(`
    SELECT r.*, (SELECT COUNT(*) FROM items i WHERE i.receipt_id = r.id) AS item_count
    FROM receipts r ORDER BY r.purchased_at DESC, r.id DESC LIMIT ?
  `).all(limit);
}

function getReceipt(id) {
  const r = db.prepare('SELECT * FROM receipts WHERE id = ?').get(id);
  if (!r) return null;
  r.items = db.prepare('SELECT * FROM items WHERE receipt_id = ? ORDER BY id').all(id);
  return r;
}

function deleteReceipt(id) {
  return db.prepare('DELETE FROM receipts WHERE id = ?').run(id).changes;
}

// 各分类花费(税前小计之和)
function statsByCategory(from, to) {
  const { where, params } = dateFilter(from, to);
  return db.prepare(`
    SELECT i.category AS label, ROUND(SUM(i.amount), 2) AS amount, COUNT(*) AS lines
    FROM items i JOIN receipts r ON r.id = i.receipt_id
    ${where}
    GROUP BY i.category ORDER BY amount DESC
  `).all(params);
}

// 某大类下的细分花费(默认肉类的牛/猪/鸡...)
function statsBySubcategory(category, from, to) {
  const { where, params } = dateFilter(from, to);
  const extra = category ? (where ? ' AND i.category = @category' : 'WHERE i.category = @category') : '';
  if (category) params.category = category;
  return db.prepare(`
    SELECT COALESCE(i.subcategory, '未分类') AS label,
           ROUND(SUM(i.amount), 2) AS amount, COUNT(*) AS lines
    FROM items i JOIN receipts r ON r.id = i.receipt_id
    ${where}${extra}
    GROUP BY i.subcategory ORDER BY amount DESC
  `).all(params);
}

// 月度: 税前/税额/实付
function statsMonthly(from, to) {
  const { where, params } = dateFilter(from, to);
  return db.prepare(`
    SELECT substr(r.purchased_at, 1, 7) AS month,
           ROUND(SUM(r.subtotal), 2) AS subtotal,
           ROUND(SUM(r.gst), 2) AS gst,
           ROUND(SUM(r.pst), 2) AS pst,
           ROUND(SUM(r.total), 2) AS total,
           COUNT(*) AS receipts
    FROM receipts r ${where}
    GROUP BY month ORDER BY month
  `).all(params);
}

// 某品名的价格趋势 (按规范名匹配，跨时间)
function priceTrend(nameNorm, store) {
  const params = { q: '%' + nameNorm + '%' };
  let storeClause = '';
  if (store) { storeClause = ' AND r.store = @store'; params.store = store; }
  return db.prepare(`
    SELECT r.purchased_at AS date, r.store AS store,
           i.name_raw AS name, i.unit, i.qty,
           i.unit_price AS unit_price, i.amount AS amount
    FROM items i JOIN receipts r ON r.id = i.receipt_id
    WHERE (i.name_norm LIKE @q OR i.name_raw LIKE @q)${storeClause}
    ORDER BY r.purchased_at
  `).all(params);
}

// 品名候选(用于趋势搜索下拉)
function distinctItemNames() {
  return db.prepare(`
    SELECT COALESCE(name_norm, name_raw) AS name, COUNT(*) AS n
    FROM items GROUP BY name ORDER BY n DESC LIMIT 300
  `).all();
}

// 概览卡片
function overview(from, to) {
  const { where, params } = dateFilter(from, to);
  const row = db.prepare(`
    SELECT ROUND(SUM(r.total), 2) AS total,
           ROUND(SUM(r.gst + r.pst), 2) AS tax,
           ROUND(SUM(r.gst), 2) AS gst,
           ROUND(SUM(r.pst), 2) AS pst,
           COUNT(*) AS receipts
    FROM receipts r ${where}
  `).get(params);
  const items = db.prepare(`
    SELECT COUNT(*) AS lines FROM items i JOIN receipts r ON r.id = i.receipt_id ${where}
  `).get(params);
  return { ...row, lines: items.lines };
}

module.exports = {
  db, saveReceipt, listReceipts, getReceipt, deleteReceipt,
  statsByCategory, statsBySubcategory, statsMonthly, priceTrend,
  distinctItemNames, overview
};
