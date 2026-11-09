'use strict';

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

// --- 极简 .env 加载 ---
// Next.js 路由处理器会自动加载 .env，但 Vitest(tests/)不经过 Next 的 .env 加载，
// 仍需要这份手写 loader(测试先注入 .env.test 的值，这里只补齐缺的键)；两边同时存在时靠 `!process.env[key]` 保护，不会重复覆盖。
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
// family_id 的外键放在 users 表建完之后单独 ALTER(见 migrateUsersFamilyFk)：
// users 依赖 families，families.creator_id 又依赖 users，建表顺序上只能先建 users(不带该外键)。
const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username      VARCHAR(100)  NOT NULL UNIQUE,
    password_hash VARCHAR(255)  NOT NULL,
    is_admin      TINYINT(1)    NOT NULL DEFAULT 0,
    family_id     INT UNSIGNED,
    family_role   ENUM('dad','mom','child','other'),
    account_type  ENUM('individual','family') NOT NULL DEFAULT 'individual',
    created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_users_family (family_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS families (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name          VARCHAR(100)  NOT NULL UNIQUE,
    creator_id    INT UNSIGNED  NOT NULL,
    created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_families_creator FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS family_join_requests (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    family_id     INT UNSIGNED  NOT NULL,
    user_id       INT UNSIGNED  NOT NULL,
    status        ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
    created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decided_at    TIMESTAMP     NULL,
    INDEX idx_fjr_family_status (family_id, status),
    CONSTRAINT fk_fjr_family FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE,
    CONSTRAINT fk_fjr_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS receipts (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id       INT UNSIGNED,
    family_id     INT UNSIGNED,
    family_name   VARCHAR(100),
    family_role   ENUM('dad','mom','child','other'),
    account_type  ENUM('individual','family') NOT NULL DEFAULT 'individual',
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
    INDEX idx_receipts_family (family_id),
    INDEX idx_receipts_image (image_file),
    CONSTRAINT fk_receipts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_receipts_family FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS items (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    receipt_id    INT UNSIGNED  NOT NULL,
    family_id     INT UNSIGNED,
    family_name   VARCHAR(100),
    family_role   ENUM('dad','mom','child','other'),
    account_type  ENUM('individual','family') NOT NULL DEFAULT 'individual',
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
    INDEX idx_items_family   (family_id),
    CONSTRAINT fk_items_receipt FOREIGN KEY (receipt_id) REFERENCES receipts(id) ON DELETE CASCADE,
    CONSTRAINT fk_items_family FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS feedback (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id       INT UNSIGNED  NOT NULL,
    content       TEXT          NOT NULL,
    created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_feedback_user (user_id),
    CONSTRAINT fk_feedback_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  // 登录失败记录(防爆破)。只记失败；username 存用户输入的原文(可能根本不存在)，所以不挂外键
  `CREATE TABLE IF NOT EXISTS login_failures (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username      VARCHAR(100)  NOT NULL,
    ip            VARCHAR(64)   NOT NULL,
    created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_lf_user_time (username, created_at),
    INDEX idx_lf_ip_time   (ip, created_at)
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

// 升级路径: 功能上线前建的 users 表没有 is_admin 列，需要在已有表上补齐
async function migrateUsersIsAdmin(conn) {
  const [rows] = await conn.query(`
    SELECT COUNT(*) AS n FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'is_admin'
  `);
  if (rows[0].n > 0) return;
  await conn.query('ALTER TABLE users ADD COLUMN is_admin TINYINT(1) NOT NULL DEFAULT 0');
}

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(`
    SELECT COUNT(*) AS n FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table AND COLUMN_NAME = :column
  `, { table, column });
  return rows[0].n > 0;
}

// 升级路径: 功能上线前建的 users 表没有家庭相关列，需要在已有表上补齐
async function migrateUsersFamilyColumns(conn) {
  if (await columnExists(conn, 'users', 'family_id')) return;
  await conn.query('ALTER TABLE users ADD COLUMN family_id INT UNSIGNED AFTER is_admin');
  await conn.query(`ALTER TABLE users ADD COLUMN family_role ENUM('dad','mom','child','other') AFTER family_id`);
  await conn.query(`ALTER TABLE users ADD COLUMN account_type ENUM('individual','family') NOT NULL DEFAULT 'individual' AFTER family_role`);
  await conn.query('ALTER TABLE users ADD INDEX idx_users_family (family_id)');
}

// users.family_id 的外键: families 表建完之后才能补上(见 SCHEMA_STATEMENTS 顶部注释)，fresh install 和升级路径都要走这一步
async function migrateUsersFamilyFk(conn) {
  const [rows] = await conn.query(`
    SELECT COUNT(*) AS n FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND CONSTRAINT_NAME = 'fk_users_family'
  `);
  if (rows[0].n > 0) return;
  await conn.query('ALTER TABLE users ADD CONSTRAINT fk_users_family FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE SET NULL');
}

// 升级路径: 功能上线前建的 receipts 表没有家庭冗余列，需要在已有表上补齐
async function migrateReceiptsFamilyColumns(conn) {
  if (await columnExists(conn, 'receipts', 'family_id')) return;
  await conn.query('ALTER TABLE receipts ADD COLUMN family_id INT UNSIGNED AFTER user_id');
  await conn.query('ALTER TABLE receipts ADD COLUMN family_name VARCHAR(100) AFTER family_id');
  await conn.query(`ALTER TABLE receipts ADD COLUMN family_role ENUM('dad','mom','child','other') AFTER family_name`);
  await conn.query(`ALTER TABLE receipts ADD COLUMN account_type ENUM('individual','family') NOT NULL DEFAULT 'individual' AFTER family_role`);
  await conn.query('ALTER TABLE receipts ADD INDEX idx_receipts_family (family_id)');
  await conn.query('ALTER TABLE receipts ADD CONSTRAINT fk_receipts_family FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE SET NULL');
}

// 升级路径: 功能上线前建的 items 表没有家庭冗余列，需要在已有表上补齐
async function migrateItemsFamilyColumns(conn) {
  if (await columnExists(conn, 'items', 'family_id')) return;
  await conn.query('ALTER TABLE items ADD COLUMN family_id INT UNSIGNED AFTER receipt_id');
  await conn.query('ALTER TABLE items ADD COLUMN family_name VARCHAR(100) AFTER family_id');
  await conn.query(`ALTER TABLE items ADD COLUMN family_role ENUM('dad','mom','child','other') AFTER family_name`);
  await conn.query(`ALTER TABLE items ADD COLUMN account_type ENUM('individual','family') NOT NULL DEFAULT 'individual' AFTER family_role`);
  await conn.query('ALTER TABLE items ADD INDEX idx_items_family (family_id)');
  await conn.query('ALTER TABLE items ADD CONSTRAINT fk_items_family FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE SET NULL');
}

// 升级路径: 已有 receipts 表没有 image_file 索引(原图鉴权按文件名反查小票时用)
async function migrateReceiptsImageIndex(conn) {
  const [rows] = await conn.query(`
    SELECT COUNT(*) AS n FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'receipts' AND INDEX_NAME = 'idx_receipts_image'
  `);
  if (rows[0].n > 0) return;
  await conn.query('ALTER TABLE receipts ADD INDEX idx_receipts_image (image_file)');
}

// 初始化管理员账号: 只在 ADMIN_USERNAME/ADMIN_PASSWORD 都配置了、且该用户名还不存在时创建一次；
// 已存在的账号(不管是不是管理员)不会被覆盖密码/角色
async function seedAdmin() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) return;
  const [rows] = await pool.execute('SELECT id, is_admin FROM users WHERE username = :username', { username });
  if (rows.length) {
    if (!rows[0].is_admin) {
      console.warn(`[db] ADMIN_USERNAME(${username}) 已存在但不是管理员，未自动提权(如需提权请手动执行 UPDATE users SET is_admin=1 WHERE username='${username}')`);
    }
    return;
  }
  const passwordHash = await bcrypt.hash(password, 10);
  await pool.execute(
    'INSERT INTO users (username, password_hash, is_admin) VALUES (:username, :password_hash, 1)',
    { username, password_hash: passwordHash }
  );
  console.log(`[db] 已初始化管理员账号: ${username}`);
}

async function initSchema() {
  try {
    const conn = await pool.getConnection();
    try {
      for (const stmt of SCHEMA_STATEMENTS) await conn.query(stmt);
      await migrateReceiptsUserId(conn);
      await migrateUsersIsAdmin(conn);
      await migrateUsersFamilyColumns(conn);
      await migrateUsersFamilyFk(conn);
      await migrateReceiptsFamilyColumns(conn);
      await migrateItemsFamilyColumns(conn);
      await migrateReceiptsImageIndex(conn);
    } finally {
      conn.release();
    }
    await seedAdmin();
  } catch (e) {
    console.warn('[db] 自动建表失败(账号可能无 DDL 权限)，请确认已手动执行 sql/schema.sql:', e.message);
  }
}
const ready = initSchema();

// ---- 用户 ----
async function createUser(username, passwordHash, { familyRole } = {}) {
  await ready;
  const [info] = await pool.execute(
    'INSERT INTO users (username, password_hash, family_role) VALUES (:username, :password_hash, :family_role)',
    { username, password_hash: passwordHash, family_role: familyRole || null }
  );
  return info.insertId;
}

// ---- 家庭 ----
async function findFamilyByName(name) {
  await ready;
  const [rows] = await pool.execute('SELECT * FROM families WHERE name = :name', { name });
  return rows[0] || null;
}

async function findFamilyById(id) {
  await ready;
  const [rows] = await pool.execute('SELECT * FROM families WHERE id = :id', { id });
  return rows[0] || null;
}

// 创建家庭，创建者本人立即成为成员(唯一有权邀请/审核的人)
async function createFamily(name, creatorId) {
  await ready;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [info] = await conn.execute('INSERT INTO families (name, creator_id) VALUES (:name, :creator_id)', { name, creator_id: creatorId });
    const familyId = info.insertId;
    await conn.execute(`UPDATE users SET family_id = :familyId, account_type = 'family' WHERE id = :creatorId`, { familyId, creatorId });
    await conn.commit();
    return familyId;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// 创建者邀请一个已注册且尚未加入任何家庭的用户，立即生效(邀请人本身即审核人，无需二次确认)
async function inviteMember(familyId, username) {
  await ready;
  const [result] = await pool.execute(
    `UPDATE users SET family_id = :familyId, account_type = 'family' WHERE username = :username AND family_id IS NULL`,
    { familyId, username }
  );
  return result.affectedRows > 0;
}

// 用户主动申请加入某个家庭，需创建者审核；重复申请(仍 pending)不产生新记录
async function applyToFamily(familyId, userId) {
  await ready;
  const [existing] = await pool.execute(
    `SELECT id FROM family_join_requests WHERE family_id = :familyId AND user_id = :userId AND status = 'pending'`,
    { familyId, userId }
  );
  if (existing.length) return existing[0].id;
  const [info] = await pool.execute(
    'INSERT INTO family_join_requests (family_id, user_id) VALUES (:familyId, :userId)',
    { familyId, userId }
  );
  return info.insertId;
}

async function listFamilyMembers(familyId) {
  await ready;
  const [rows] = await pool.execute(
    'SELECT id, username, family_role, created_at FROM users WHERE family_id = :familyId ORDER BY created_at',
    { familyId }
  );
  return rows;
}

async function listPendingRequests(familyId) {
  await ready;
  const [rows] = await pool.execute(`
    SELECT fjr.id, fjr.user_id, u.username, fjr.created_at
    FROM family_join_requests fjr JOIN users u ON u.id = fjr.user_id
    WHERE fjr.family_id = :familyId AND fjr.status = 'pending'
    ORDER BY fjr.created_at
  `, { familyId });
  return rows;
}

// approve=true 通过并把申请人拉进家庭，false 仅标记拒绝；familyId 由调用方(创建者本人)传入，
// 保证只能审核自己家庭下的申请，不会被猜 requestId 越权批准别的家庭
async function decideRequest(requestId, familyId, approve) {
  await ready;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute(
      `SELECT * FROM family_join_requests WHERE id = :requestId AND family_id = :familyId AND status = 'pending'`,
      { requestId, familyId }
    );
    const reqRow = rows[0];
    if (!reqRow) { await conn.rollback(); return false; }
    await conn.execute(
      `UPDATE family_join_requests SET status = :status, decided_at = NOW() WHERE id = :requestId`,
      { requestId, status: approve ? 'approved' : 'rejected' }
    );
    if (approve) {
      await conn.execute(
        `UPDATE users SET family_id = :familyId, account_type = 'family' WHERE id = :userId AND family_id IS NULL`,
        { familyId, userId: reqRow.user_id }
      );
    }
    await conn.commit();
    return true;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
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

async function findUserById(id) {
  await ready;
  const [rows] = await pool.execute('SELECT * FROM users WHERE id = :id', { id });
  return rows[0] || null;
}

// 每个请求校验会话用: 一次主键查询拿到用户当前的权限与家庭(含家庭名、创建者)，以库为准、不信任 cookie 缓存
async function getSessionUser(id) {
  await ready;
  const [rows] = await pool.execute(`
    SELECT u.id, u.username, u.is_admin, u.family_id, u.family_role, u.account_type,
           f.name AS family_name, f.creator_id AS family_creator_id
    FROM users u LEFT JOIN families f ON f.id = u.family_id
    WHERE u.id = :id
  `, { id });
  return rows[0] || null;
}

// 原图鉴权: 按文件名反查所属小票的上传者与家庭；文件不属于任何小票时返回 null
async function findImageOwner(imageFile) {
  await ready;
  const [rows] = await pool.execute(
    'SELECT user_id, family_id FROM receipts WHERE image_file = :imageFile LIMIT 1',
    { imageFile }
  );
  return rows[0] || null;
}

// ---- 登录防爆破 ----
// 列宽: username VARCHAR(100)、ip VARCHAR(64)。写入和查询都用同样的截断，超长输入既不会 500，也能落进同一个桶
const lfUser = (u) => String(u || '').slice(0, 100);
// ip 为 null(取不到客户端 IP)时存空串，并在所有查询里跳过 IP 维度
const lfIp = (ip) => (ip ? String(ip).slice(0, 64) : '');

// 最近 windowMinutes 分钟内，该用户名 / 该 IP 各自的记录数(含正在进行中的尝试)
async function countRecentLoginFailures(username, ip, windowMinutes) {
  await ready;
  const [rows] = await pool.execute(`
    SELECT COALESCE(SUM(username = :username), 0) AS byUser,
           COALESCE(SUM(:ip <> '' AND ip = :ip), 0) AS byIp
    FROM login_failures
    WHERE created_at > NOW() - INTERVAL :windowMinutes MINUTE AND (username = :username OR (:ip <> '' AND ip = :ip))
  `, { username: lfUser(username), ip: lfIp(ip), windowMinutes });
  return { byUser: Number(rows[0].byUser), byIp: Number(rows[0].byIp) };
}

// 固定时长锁定: 取该维度最近一次失败 L(须在 windowMinutes 内)，若 (L - window, L] 内失败数 >= max，
// 说明在 L 时刻凑满了阈值，锁到 L + window。锁定期间的请求不再写记录，L 不会后移，所以恰好锁满 window 分钟。
async function isLoginLocked(username, ip, max, windowMinutes) {
  await ready;
  const dims = [['username', lfUser(username)]];
  if (lfIp(ip)) dims.push(['ip', lfIp(ip)]);
  for (const [col, value] of dims) {
    const [rows] = await pool.execute(`
      SELECT COUNT(*) AS n
      FROM login_failures f
      JOIN (SELECT MAX(created_at) AS m FROM login_failures
            WHERE ${col} = :value AND created_at > NOW() - INTERVAL :windowMinutes MINUTE) last
        ON f.created_at > last.m - INTERVAL :windowMinutes MINUTE AND f.created_at <= last.m
      WHERE f.${col} = :value
    `, { value, windowMinutes });
    if (Number(rows[0].n) >= max) return true;
  }
  return false;
}

// 记一次登录尝试(先记再校验密码，见 login 路由)，返回记录 id。失败就保留，成功或被拒时由调用方删除
async function recordLoginFailure(username, ip) {
  await ready;
  const [info] = await pool.execute(
    'INSERT INTO login_failures (username, ip) VALUES (:username, :ip)',
    { username: lfUser(username), ip: lfIp(ip) }
  );
  // 顺手清掉一天前的旧记录，表不会无限增长
  await pool.execute('DELETE FROM login_failures WHERE created_at < NOW() - INTERVAL 1 DAY');
  return info.insertId;
}

async function deleteLoginAttempt(id) {
  await ready;
  await pool.execute('DELETE FROM login_failures WHERE id = :id', { id });
}

// 登录成功后清零该用户名的失败计数(不清 IP 维度，避免一个账号登录成功就给整个 IP 解锁)
async function clearLoginFailures(username) {
  await ready;
  await pool.execute('DELETE FROM login_failures WHERE username = :username', { username: lfUser(username) });
}

async function updatePassword(id, passwordHash) {
  await ready;
  await pool.execute('UPDATE users SET password_hash = :password_hash WHERE id = :id', { id, password_hash: passwordHash });
}

// 迁移: 把功能上线前的无主小票全部归给首个注册账号
async function backfillOwnerlessReceipts(userId) {
  await ready;
  const [result] = await pool.execute('UPDATE receipts SET user_id = :userId WHERE user_id IS NULL', { userId });
  return result.affectedRows;
}

// ---- 写入 ----
// receipt.family_id/family_name/family_role/account_type: 建票时从上传者当前的 users 行拷贝下来的冗余字段
// (调用方——route handler——负责从 session 填好；测试等不传时落到下面的默认值，等同"个人账号")，
// 目的是家庭内可见性/统计能直接按 receipts/items 的列过滤或分组，不必每次 JOIN users
async function saveReceipt(receipt, items) {
  await ready;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [info] = await conn.execute(`
      INSERT INTO receipts (user_id, family_id, family_name, family_role, account_type, store, purchased_at, currency, subtotal, gst, pst, total, image_file, raw_json)
      VALUES (:user_id, :family_id, :family_name, :family_role, :account_type, :store, :purchased_at, :currency, :subtotal, :gst, :pst, :total, :image_file, :raw_json)
    `, {
      family_id: null, family_name: null, family_role: null, account_type: 'individual',
      ...receipt,
    });
    const rid = info.insertId;
    for (const it of items) {
      await conn.execute(`
        INSERT INTO items (receipt_id, family_id, family_name, family_role, account_type, name_raw, name_norm, category, subcategory, qty, unit, unit_price, amount, taxable)
        VALUES (:receipt_id, :family_id, :family_name, :family_role, :account_type, :name_raw, :name_norm, :category, :subcategory, :qty, :unit, :unit_price, :amount, :taxable)
      `, {
        ...it,
        receipt_id: rid,
        family_id: receipt.family_id ?? null,
        family_name: receipt.family_name ?? null,
        family_role: receipt.family_role ?? null,
        account_type: receipt.account_type || 'individual',
      });
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
// scope: { familyId } 家庭内互相可见(按 family_id 过滤，看得到所有家庭成员的数据)；
//        { userId } 只看自己(个人账号，或未在家庭里)；
//        都不传(管理后台用)则不加这个过滤，查全部用户
function dateFilter(from, to, scope) {
  const clauses = [];
  const params = {};
  if (scope && scope.familyId) { clauses.push('r.family_id = :familyId'); params.familyId = scope.familyId; }
  else if (scope && scope.userId) { clauses.push('r.user_id = :userId'); params.userId = scope.userId; }
  if (from) { clauses.push('r.purchased_at >= :from'); params.from = from; }
  if (to)   { clauses.push('r.purchased_at <= :to');   params.to = to; }
  return { where: clauses.length ? 'WHERE ' + clauses.join(' AND ') : '', params };
}

async function listReceipts({ limit = 200, from, to, search, scope } = {}) {
  await ready;
  const lim = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 2000);
  const { where, params } = dateFilter(from, to, scope);
  const clauses = where ? [where.slice('WHERE '.length)] : [];
  if (search) {
    clauses.push(`(r.store LIKE :search OR EXISTS (
      SELECT 1 FROM items i2 WHERE i2.receipt_id = r.id AND (i2.name_raw LIKE :search OR i2.name_norm LIKE :search)
    ))`);
    params.search = '%' + search + '%';
  }
  const whereClause = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const [rows] = await pool.execute(`
    SELECT r.*, u.username AS owner_username, (SELECT COUNT(*) FROM items i WHERE i.receipt_id = r.id) AS item_count
    FROM receipts r LEFT JOIN users u ON u.id = r.user_id
    ${whereClause} ORDER BY r.purchased_at DESC, r.id DESC LIMIT ${lim}
  `, params);
  return rows;
}

async function getReceipt(id, scope) {
  await ready;
  let clause = 'r.id = :id';
  const params = { id };
  if (scope && scope.familyId) { clause += ' AND r.family_id = :familyId'; params.familyId = scope.familyId; }
  else if (scope && scope.userId) { clause += ' AND r.user_id = :userId'; params.userId = scope.userId; }
  const [rows] = await pool.execute(`
    SELECT r.*, u.username AS owner_username FROM receipts r LEFT JOIN users u ON u.id = r.user_id WHERE ${clause}
  `, params);
  const r = rows[0];
  if (!r) return null;
  const [items] = await pool.execute('SELECT * FROM items WHERE receipt_id = :id ORDER BY id', { id });
  r.items = items;
  return r;
}

async function deleteReceipt(id, userId) {
  await ready;
  const clause = userId ? 'id = :id AND user_id = :userId' : 'id = :id';
  const params = userId ? { id, userId } : { id };
  const [result] = await pool.execute(`DELETE FROM receipts WHERE ${clause}`, params);
  return result.affectedRows;
}

// 各分类花费(税前小计之和)
async function statsByCategory(from, to, scope) {
  await ready;
  const { where, params } = dateFilter(from, to, scope);
  const [rows] = await pool.execute(`
    SELECT i.category AS label, ROUND(SUM(i.amount), 2) AS amount, COUNT(*) AS line_count
    FROM items i JOIN receipts r ON r.id = i.receipt_id
    ${where}
    GROUP BY i.category ORDER BY amount DESC
  `, params);
  return rows.map(({ line_count, ...r }) => ({ ...r, lines: line_count }));
}

// 某大类下的细分花费(默认肉类的牛/猪/鸡...)
async function statsBySubcategory(category, from, to, scope) {
  await ready;
  const { where, params } = dateFilter(from, to, scope);
  let extra = '';
  if (category) {
    extra = where ? ' AND i.category = :category' : 'WHERE i.category = :category';
    params.category = category;
  }
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
async function statsMonthly(from, to, scope) {
  await ready;
  const { where, params } = dateFilter(from, to, scope);
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

// 某品名的价格趋势 (按规范名匹配，跨时间); scope 语义同 dateFilter
async function priceTrend(nameNorm, store, scope) {
  await ready;
  const params = { q: '%' + nameNorm + '%' };
  let scopeClause;
  if (scope && scope.familyId) { scopeClause = 'r.family_id = :familyId'; params.familyId = scope.familyId; }
  else { scopeClause = 'r.user_id = :userId'; params.userId = scope && scope.userId; }
  let storeClause = '';
  if (store) { storeClause = ' AND r.store = :store'; params.store = store; }
  const [rows] = await pool.execute(`
    SELECT r.purchased_at AS date, r.store AS store,
           i.name_raw AS name, i.unit, i.qty,
           i.unit_price AS unit_price, i.amount AS amount
    FROM items i JOIN receipts r ON r.id = i.receipt_id
    WHERE ${scopeClause} AND (i.name_norm LIKE :q OR i.name_raw LIKE :q)${storeClause}
    ORDER BY r.purchased_at
  `, params);
  return rows;
}

// 品名候选(用于趋势搜索下拉); scope 语义同 dateFilter
async function distinctItemNames(scope) {
  await ready;
  let scopeClause, params;
  if (scope && scope.familyId) { scopeClause = 'r.family_id = :familyId'; params = { familyId: scope.familyId }; }
  else { scopeClause = 'r.user_id = :userId'; params = { userId: scope && scope.userId }; }
  const [rows] = await pool.execute(`
    SELECT COALESCE(i.name_norm, i.name_raw) AS name, COUNT(*) AS n
    FROM items i JOIN receipts r ON r.id = i.receipt_id
    WHERE ${scopeClause}
    GROUP BY name ORDER BY n DESC LIMIT 300
  `, params);
  return rows;
}

// 概览卡片
async function overview(from, to, scope) {
  await ready;
  const { where, params } = dateFilter(from, to, scope);
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

// ---- 管理后台 ----
// 用户列表: 附带每个用户的小票数与总花费
async function listUsers() {
  await ready;
  const [rows] = await pool.execute(`
    SELECT u.id, u.username, u.is_admin, u.account_type, u.family_role, f.name AS family_name, u.created_at,
           COUNT(r.id) AS receipt_count,
           ROUND(COALESCE(SUM(r.total), 0), 2) AS total_spend
    FROM users u
    LEFT JOIN receipts r ON r.user_id = u.id
    LEFT JOIN families f ON f.id = u.family_id
    GROUP BY u.id, u.username, u.is_admin, u.account_type, u.family_role, f.name, u.created_at
    ORDER BY u.created_at
  `);
  return rows;
}

async function deleteUser(id) {
  await ready;
  const [result] = await pool.execute('DELETE FROM users WHERE id = :id', { id });
  return result.affectedRows;
}

// 各用户花费: LEFT JOIN 保证没有小票的用户也会出现(花费为 0)，日期条件放在 ON 里而非 WHERE，
// 否则会把这些用户过滤掉
async function statsByUser(from, to) {
  await ready;
  const clauses = [];
  const params = {};
  if (from) { clauses.push('r.purchased_at >= :from'); params.from = from; }
  if (to)   { clauses.push('r.purchased_at <= :to');   params.to = to; }
  const dateCond = clauses.length ? ' AND ' + clauses.join(' AND ') : '';
  const [rows] = await pool.execute(`
    SELECT u.id AS user_id, u.username,
           ROUND(COALESCE(SUM(r.total), 0), 2) AS total,
           COUNT(r.id) AS receipts
    FROM users u
    LEFT JOIN receipts r ON r.user_id = u.id${dateCond}
    GROUP BY u.id, u.username
    ORDER BY total DESC
  `, params);
  return rows;
}

// ---- 反馈 ----
async function addFeedback(userId, content) {
  await ready;
  const [info] = await pool.execute('INSERT INTO feedback (user_id, content) VALUES (:userId, :content)', { userId, content });
  return info.insertId;
}

async function listFeedbackByUser(userId) {
  await ready;
  const [rows] = await pool.execute('SELECT * FROM feedback WHERE user_id = :userId ORDER BY created_at DESC', { userId });
  return rows;
}

async function listAllFeedback() {
  await ready;
  const [rows] = await pool.execute(`
    SELECT f.*, u.username FROM feedback f JOIN users u ON u.id = f.user_id ORDER BY f.created_at DESC
  `);
  return rows;
}

module.exports = {
  pool, saveReceipt, listReceipts, getReceipt, deleteReceipt,
  statsByCategory, statsBySubcategory, statsMonthly, priceTrend,
  distinctItemNames, overview,
  createUser, findUserByUsername, findUserById, countUsers, backfillOwnerlessReceipts,
  updatePassword, getSessionUser, findImageOwner,
  countRecentLoginFailures, isLoginLocked, recordLoginFailure, deleteLoginAttempt, clearLoginFailures,
  listUsers, deleteUser, statsByUser,
  findFamilyByName, findFamilyById, createFamily, inviteMember, applyToFamily,
  listFamilyMembers, listPendingRequests, decideRequest,
  addFeedback, listFeedbackByUser, listAllFeedback,
};
