'use strict';

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

// --- 极简 .env 加载 (与 server.js 一致，独立加载以支持 selfcheck.js 等单独入口) ---
(function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
})();

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
  dateStrings: true,     // purchased_at/created_at 以 'YYYY-MM-DD ...' 字符串返回，兼容既有前端逻辑
  decimalNumbers: true,  // DECIMAL 列以 JS number 返回，兼容既有前端逻辑
});

// 与 sql/schema.sql 保持一致；应用启动时尝试自动建表，若数据库账号无 DDL 权限则忽略，
// 此时需提前手动执行 sql/schema.sql
const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS receipts (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    store         VARCHAR(255)  NOT NULL DEFAULT '未知',
    purchased_at  DATE          NOT NULL,
    currency      VARCHAR(10)   NOT NULL DEFAULT 'CAD',
    subtotal      DECIMAL(10,2) NOT NULL DEFAULT 0,
    gst           DECIMAL(10,2) NOT NULL DEFAULT 0,
    pst           DECIMAL(10,2) NOT NULL DEFAULT 0,
    total         DECIMAL(10,2) NOT NULL DEFAULT 0,
    image_file    VARCHAR(255),
    raw_json      LONGTEXT,
    created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_receipts_date (purchased_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS items (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    receipt_id    INT UNSIGNED  NOT NULL,
    name_raw      VARCHAR(255)  NOT NULL,
    name_norm     VARCHAR(255),
    category      VARCHAR(100)  NOT NULL DEFAULT '其他',
    subcategory   VARCHAR(100),
    qty           DECIMAL(10,3) NOT NULL DEFAULT 1,
    unit          VARCHAR(50),
    unit_price    DECIMAL(10,4),
    amount        DECIMAL(10,2) NOT NULL DEFAULT 0,
    taxable       TINYINT(1)    NOT NULL DEFAULT 0,
    created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_items_receipt  (receipt_id),
    INDEX idx_items_category (category),
    INDEX idx_items_subcat   (subcategory),
    INDEX idx_items_norm     (name_norm),
    CONSTRAINT fk_items_receipt FOREIGN KEY (receipt_id) REFERENCES receipts(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

async function initSchema() {
  try {
    const conn = await pool.getConnection();
    try {
      for (const stmt of SCHEMA_STATEMENTS) await conn.query(stmt);
    } finally {
      conn.release();
    }
  } catch (e) {
    console.warn('[db] 自动建表失败(账号可能无 DDL 权限)，请确认已手动执行 sql/schema.sql:', e.message);
  }
}
const ready = initSchema();

// ---- 写入 ----
async function saveReceipt(receipt, items) {
  await ready;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [info] = await conn.execute(`
      INSERT INTO receipts (store, purchased_at, currency, subtotal, gst, pst, total, image_file, raw_json)
      VALUES (:store, :purchased_at, :currency, :subtotal, :gst, :pst, :total, :image_file, :raw_json)
    `, receipt);
    const rid = info.insertId;
    for (const it of items) {
      await conn.execute(`
        INSERT INTO items (receipt_id, name_raw, name_norm, category, subcategory, qty, unit, unit_price, amount, taxable)
        VALUES (:receipt_id, :name_raw, :name_norm, :category, :subcategory, :qty, :unit, :unit_price, :amount, :taxable)
      `, { ...it, receipt_id: rid });
    }
    await conn.commit();
    return rid;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// ---- 查询 ----
function dateFilter(from, to) {
  const clauses = [];
  const params = {};
  if (from) { clauses.push('r.purchased_at >= :from'); params.from = from; }
  if (to)   { clauses.push('r.purchased_at <= :to');   params.to = to; }
  return { where: clauses.length ? 'WHERE ' + clauses.join(' AND ') : '', params };
}

async function listReceipts({ limit = 200, from, to, search } = {}) {
  await ready;
  const lim = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 2000);
  const { where, params } = dateFilter(from, to);
  const clauses = where ? [where.slice('WHERE '.length)] : [];
  if (search) {
    clauses.push(`(r.store LIKE :search OR EXISTS (
      SELECT 1 FROM items i2 WHERE i2.receipt_id = r.id AND (i2.name_raw LIKE :search OR i2.name_norm LIKE :search)
    ))`);
    params.search = '%' + search + '%';
  }
  const whereClause = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const [rows] = await pool.execute(`
    SELECT r.*, (SELECT COUNT(*) FROM items i WHERE i.receipt_id = r.id) AS item_count
    FROM receipts r ${whereClause} ORDER BY r.purchased_at DESC, r.id DESC LIMIT ${lim}
  `, params);
  return rows;
}

async function getReceipt(id) {
  await ready;
  const [rows] = await pool.execute('SELECT * FROM receipts WHERE id = :id', { id });
  const r = rows[0];
  if (!r) return null;
  const [items] = await pool.execute('SELECT * FROM items WHERE receipt_id = :id ORDER BY id', { id });
  r.items = items;
  return r;
}

async function deleteReceipt(id) {
  await ready;
  const [result] = await pool.execute('DELETE FROM receipts WHERE id = :id', { id });
  return result.affectedRows;
}

// 各分类花费(税前小计之和)
async function statsByCategory(from, to) {
  await ready;
  const { where, params } = dateFilter(from, to);
  const [rows] = await pool.execute(`
    SELECT i.category AS label, ROUND(SUM(i.amount), 2) AS amount, COUNT(*) AS line_count
    FROM items i JOIN receipts r ON r.id = i.receipt_id
    ${where}
    GROUP BY i.category ORDER BY amount DESC
  `, params);
  return rows.map(({ line_count, ...r }) => ({ ...r, lines: line_count }));
}

// 某大类下的细分花费(默认肉类的牛/猪/鸡...)
async function statsBySubcategory(category, from, to) {
  await ready;
  const { where, params } = dateFilter(from, to);
  const extra = category ? (where ? ' AND i.category = :category' : 'WHERE i.category = :category') : '';
  if (category) params.category = category;
  const [rows] = await pool.execute(`
    SELECT COALESCE(i.subcategory, '未分类') AS label,
           ROUND(SUM(i.amount), 2) AS amount, COUNT(*) AS line_count
    FROM items i JOIN receipts r ON r.id = i.receipt_id
    ${where}${extra}
    GROUP BY i.subcategory ORDER BY amount DESC
  `, params);
  return rows.map(({ line_count, ...r }) => ({ ...r, lines: line_count }));
}

// 月度: 税前/税额/实付
async function statsMonthly(from, to) {
  await ready;
  const { where, params } = dateFilter(from, to);
  const [rows] = await pool.execute(`
    SELECT DATE_FORMAT(r.purchased_at, '%Y-%m') AS month,
           ROUND(SUM(r.subtotal), 2) AS subtotal,
           ROUND(SUM(r.gst), 2) AS gst,
           ROUND(SUM(r.pst), 2) AS pst,
           ROUND(SUM(r.total), 2) AS total,
           COUNT(*) AS receipts
    FROM receipts r ${where}
    GROUP BY month ORDER BY month
  `, params);
  return rows;
}

// 某品名的价格趋势 (按规范名匹配，跨时间)
async function priceTrend(nameNorm, store) {
  await ready;
  const params = { q: '%' + nameNorm + '%' };
  let storeClause = '';
  if (store) { storeClause = ' AND r.store = :store'; params.store = store; }
  const [rows] = await pool.execute(`
    SELECT r.purchased_at AS date, r.store AS store,
           i.name_raw AS name, i.unit, i.qty,
           i.unit_price AS unit_price, i.amount AS amount
    FROM items i JOIN receipts r ON r.id = i.receipt_id
    WHERE (i.name_norm LIKE :q OR i.name_raw LIKE :q)${storeClause}
    ORDER BY r.purchased_at
  `, params);
  return rows;
}

// 品名候选(用于趋势搜索下拉)
async function distinctItemNames() {
  await ready;
  const [rows] = await pool.query(`
    SELECT COALESCE(name_norm, name_raw) AS name, COUNT(*) AS n
    FROM items GROUP BY name ORDER BY n DESC LIMIT 300
  `);
  return rows;
}

// 概览卡片
async function overview(from, to) {
  await ready;
  const { where, params } = dateFilter(from, to);
  const [rows] = await pool.execute(`
    SELECT ROUND(SUM(r.total), 2) AS total,
           ROUND(SUM(r.gst + r.pst), 2) AS tax,
           ROUND(SUM(r.gst), 2) AS gst,
           ROUND(SUM(r.pst), 2) AS pst,
           COUNT(*) AS receipts
    FROM receipts r ${where}
  `, params);
  const [items] = await pool.execute(`
    SELECT COUNT(*) AS line_count FROM items i JOIN receipts r ON r.id = i.receipt_id ${where}
  `, params);
  return { ...rows[0], lines: items[0].line_count };
}

module.exports = {
  pool, saveReceipt, listReceipts, getReceipt, deleteReceipt,
  statsByCategory, statsBySubcategory, statsMonthly, priceTrend,
  distinctItemNames, overview
};
