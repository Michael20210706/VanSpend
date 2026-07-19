'use strict';

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

// --- 极简 .env 加载 ---
// Next.js 路由处理器会自动加载 .env，但 scripts/selfcheck.js 用纯 node 直接运行、不经过 Next，
// 仍需要这份手写 loader；两边同时存在时靠 `!process.env[key]` 保护，不会重复覆盖。
(function loadEnv() {
  // process.cwd() 而非 __dirname: 避免被 Next.js/Turbopack 打包后虚拟化的路径影响(见 uploads.cjs 注释)
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
})();

// 开发模式下 `next dev` 的模块热重载会重新执行本文件；用 globalThis 挂一个单例，
// 避免每次热重载都新建一个连接池、耗尽 MySQL 连接数(Next.js 官方推荐的做法，Prisma 等库同理)。
const pool = globalThis.__vanspendPool || mysql.createPool({
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
if (process.env.NODE_ENV !== 'production') globalThis.__vanspendPool = pool;

// 与 sql/schema.sql 保持一致；应用启动时尝试自动建表，若数据库账号无 DDL 权限则忽略，
// 此时需提前手动执行 sql/schema.sql
const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username      VARCHAR(100)  NOT NULL UNIQUE,
    password_hash VARCHAR(255)  NOT NULL,
    created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS receipts (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id       INT UNSIGNED,
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
    INDEX idx_receipts_date (purchased_at),
    INDEX idx_receipts_user (user_id),
    CONSTRAINT fk_receipts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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

// 升级路径: 功能上线前建的 receipts 表没有 user_id 列，需要在已有表上补齐
async function migrateReceiptsUserId(conn) {
  const [rows] = await conn.query(`
    SELECT COUNT(*) AS n FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'receipts' AND COLUMN_NAME = 'user_id'
  `);
  if (rows[0].n > 0) return;
  await conn.query('ALTER TABLE receipts ADD COLUMN user_id INT UNSIGNED AFTER id');
  await conn.query('ALTER TABLE receipts ADD INDEX idx_receipts_user (user_id)');
  await conn.query('ALTER TABLE receipts ADD CONSTRAINT fk_receipts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE');
}

async function initSchema() {
  try {
    const conn = await pool.getConnection();
    try {
      for (const stmt of SCHEMA_STATEMENTS) await conn.query(stmt);
      await migrateReceiptsUserId(conn);
    } finally {
      conn.release();
    }
  } catch (e) {
    console.warn('[db] 自动建表失败(账号可能无 DDL 权限)，请确认已手动执行 sql/schema.sql:', e.message);
  }
}
const ready = initSchema();

// ---- 用户 ----
async function createUser(username, passwordHash) {
  await ready;
  const [info] = await pool.execute(
    'INSERT INTO users (username, password_hash) VALUES (:username, :password_hash)',
    { username, password_hash: passwordHash }
  );
  return info.insertId;
}

async function findUserByUsername(username) {
  await ready;
  const [rows] = await pool.execute('SELECT * FROM users WHERE username = :username', { username });
  return rows[0] || null;
}

async function countUsers() {
  await ready;
  const [rows] = await pool.query('SELECT COUNT(*) AS n FROM users');
  return rows[0].n;
}

// 迁移: 把功能上线前的无主小票全部归给首个注册账号
async function backfillOwnerlessReceipts(userId) {
  await ready;
  const [result] = await pool.execute('UPDATE receipts SET user_id = :userId WHERE user_id IS NULL', { userId });
  return result.affectedRows;
}

// ---- 写入 ----
async function saveReceipt(receipt, items) {
  await ready;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [info] = await conn.execute(`
      INSERT INTO receipts (user_id, store, purchased_at, currency, subtotal, gst, pst, total, image_file, raw_json)
      VALUES (:user_id, :store, :purchased_at, :currency, :subtotal, :gst, :pst, :total, :image_file, :raw_json)
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
// userId 必填: 每个用户只能查到自己名下的小票/统计数据
function dateFilter(from, to, userId) {
  const clauses = ['r.user_id = :userId'];
  const params = { userId };
  if (from) { clauses.push('r.purchased_at >= :from'); params.from = from; }
  if (to)   { clauses.push('r.purchased_at <= :to');   params.to = to; }
  return { where: 'WHERE ' + clauses.join(' AND '), params };
}

async function listReceipts({ limit = 200, from, to, search, userId } = {}) {
  await ready;
  const lim = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 2000);
  const { where, params } = dateFilter(from, to, userId);
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

async function getReceipt(id, userId) {
  await ready;
  const [rows] = await pool.execute('SELECT * FROM receipts WHERE id = :id AND user_id = :userId', { id, userId });
  const r = rows[0];
  if (!r) return null;
  const [items] = await pool.execute('SELECT * FROM items WHERE receipt_id = :id ORDER BY id', { id });
  r.items = items;
  return r;
}

async function deleteReceipt(id, userId) {
  await ready;
  const [result] = await pool.execute('DELETE FROM receipts WHERE id = :id AND user_id = :userId', { id, userId });
  return result.affectedRows;
}

// 各分类花费(税前小计之和)
async function statsByCategory(from, to, userId) {
  await ready;
  const { where, params } = dateFilter(from, to, userId);
  const [rows] = await pool.execute(`
    SELECT i.category AS label, ROUND(SUM(i.amount), 2) AS amount, COUNT(*) AS line_count
    FROM items i JOIN receipts r ON r.id = i.receipt_id
    ${where}
    GROUP BY i.category ORDER BY amount DESC
  `, params);
  return rows.map(({ line_count, ...r }) => ({ ...r, lines: line_count }));
}

// 某大类下的细分花费(默认肉类的牛/猪/鸡...)
async function statsBySubcategory(category, from, to, userId) {
  await ready;
  const { where, params } = dateFilter(from, to, userId);
  const extra = category ? ' AND i.category = :category' : '';
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
async function statsMonthly(from, to, userId) {
  await ready;
  const { where, params } = dateFilter(from, to, userId);
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
async function priceTrend(nameNorm, store, userId) {
  await ready;
  const params = { q: '%' + nameNorm + '%', userId };
  let storeClause = '';
  if (store) { storeClause = ' AND r.store = :store'; params.store = store; }
  const [rows] = await pool.execute(`
    SELECT r.purchased_at AS date, r.store AS store,
           i.name_raw AS name, i.unit, i.qty,
           i.unit_price AS unit_price, i.amount AS amount
    FROM items i JOIN receipts r ON r.id = i.receipt_id
    WHERE r.user_id = :userId AND (i.name_norm LIKE :q OR i.name_raw LIKE :q)${storeClause}
    ORDER BY r.purchased_at
  `, params);
  return rows;
}

// 品名候选(用于趋势搜索下拉)
async function distinctItemNames(userId) {
  await ready;
  const [rows] = await pool.execute(`
    SELECT COALESCE(i.name_norm, i.name_raw) AS name, COUNT(*) AS n
    FROM items i JOIN receipts r ON r.id = i.receipt_id
    WHERE r.user_id = :userId
    GROUP BY name ORDER BY n DESC LIMIT 300
  `, { userId });
  return rows;
}

// 概览卡片
async function overview(from, to, userId) {
  await ready;
  const { where, params } = dateFilter(from, to, userId);
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
  distinctItemNames, overview,
  createUser, findUserByUsername, countUsers, backfillOwnerlessReceipts
};
