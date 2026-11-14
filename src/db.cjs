'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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
  timezone: 'Z',         // 写入的 Date 参数按 UTC 序列化(不依赖机器时区)
});
// 每条新连接显式把会话时区设为 UTC: NOW()/CURRENT_TIMESTAMP 写入与 TIMESTAMP 读出(dateStrings 返回的字符串)都是 UTC，
// 前端 lib/time.js 据此按 UTC 解析再转本地时间。TIMESTAMP 内部存的就是 UTC 瞬间，所以不改变任何已存数据的含义。
if (!globalThis.__vanspendPool) {
  pool.on('connection', (c) => { c.query("SET time_zone = '+00:00'"); });
}
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
    family_joined_at TIMESTAMP NULL DEFAULT NULL,
    account_type  ENUM('individual','family') NOT NULL DEFAULT 'individual',
    signup_source ENUM('invite','open') NOT NULL DEFAULT 'invite',
    scan_tier     ENUM('open','normal') NOT NULL DEFAULT 'normal',
    invited_by    INT UNSIGNED,
    must_change_password TINYINT(1) NOT NULL DEFAULT 0,
    created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_users_family (family_id),
    INDEX idx_users_invited_by (invited_by),
    CONSTRAINT fk_users_invited_by FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  // 管理员写操作日志: 只增不改(没有任何修改/删除它的接口)。操作人、对象都存一份文字快照，对象或操作人之后被删也看得懂；
  // admin_id 外键 ON DELETE SET NULL，操作人账号被删后日志保留。不记录查看。
  `CREATE TABLE IF NOT EXISTS admin_audit_log (
    id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    admin_id       INT UNSIGNED,
    admin_username VARCHAR(100)  NOT NULL,
    action         VARCHAR(40)   NOT NULL,
    target_type    ENUM('user','receipt') NOT NULL,
    target_id      INT UNSIGNED  NOT NULL,
    target_label   VARCHAR(255)  NOT NULL,
    detail         VARCHAR(255),
    created_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_audit_created (created_at),
    CONSTRAINT fk_audit_admin FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE SET NULL
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
  // 已登录用户"输密码确认"(修改密码、注销账号)的错误尝试记录。按用户 id 记，而不是复用 login_failures:
  // login_failures 的 username 列存的是登录框里随便输入的字符串，用户可以输入任何值(包括伪造的键)去干扰别人的计数；
  // 这张表只能由服务端按已认证的 user_id 写入，外部输入够不着。账号被删时连带清掉
  `CREATE TABLE IF NOT EXISTS pw_failures (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id       INT UNSIGNED  NOT NULL,
    created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_pwf_user_time (user_id, created_at),
    CONSTRAINT fk_pwf_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  // 已用过的验证码 token(其 SHA-256)。验证码 token 本身是无状态的签名串，5 分钟内本可无限次重放；
  // 注册时把用过的 token 记在这里，同一个 token 只能用一次。过期(10 分钟，比 token 有效期长)的行在每次写入时顺手清掉
  `CREATE TABLE IF NOT EXISTS captcha_used (
    token_key     CHAR(64)      NOT NULL PRIMARY KEY,
    created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_captcha_used_time (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  // 开放注册(过了验证码)的尝试记录，按 IP 限速用。和 login_failures 一样没有外键，只存 IP
  `CREATE TABLE IF NOT EXISTS signup_attempts (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    ip            VARCHAR(64)   NOT NULL,
    created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_signup_ip_time (ip, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  // 邀请码: 单次有效。family_id 非空 = 入家庭邀请码(注册后直接加入该家庭)。
  // 码本身是 128 位随机数(base64url)，不可猜；状态(未用/已用/作废/过期)由 used_by/revoked_at/expires_at 推出
  `CREATE TABLE IF NOT EXISTS invite_codes (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    code          VARCHAR(40)   NOT NULL UNIQUE,
    created_by    INT UNSIGNED  NOT NULL,
    family_id     INT UNSIGNED,
    expires_at    DATETIME      NOT NULL,
    used_by       INT UNSIGNED,
    used_at       TIMESTAMP     NULL,
    revoked_at    TIMESTAMP     NULL,
    created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_invite_creator (created_by),
    CONSTRAINT fk_invite_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_invite_family  FOREIGN KEY (family_id)  REFERENCES families(id) ON DELETE CASCADE,
    CONSTRAINT fk_invite_used_by FOREIGN KEY (used_by)    REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  // 每次调用 OpenRouter 的记录(成功与否都记)，同时是每日扫描额度的计数依据。success NULL = 进行中
  `CREATE TABLE IF NOT EXISTS scan_log (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id       INT UNSIGNED  NOT NULL,
    model         VARCHAR(100),
    success       TINYINT(1),
    created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_scan_user_time (user_id, created_at),
    CONSTRAINT fk_scan_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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

// 升级路径: 已有 users 表没有邀请/额度相关列。老账号取列默认值 signup_source='invite'、scan_tier='normal'
// (即"按邀请注册、正常额度"处理，不受开放注册的每天 3 次限制)
async function migrateUsersInviteColumns(conn) {
  if (!(await columnExists(conn, 'users', 'signup_source'))) {
    await conn.query(`ALTER TABLE users ADD COLUMN signup_source ENUM('invite','open') NOT NULL DEFAULT 'invite' AFTER account_type`);
  }
  if (!(await columnExists(conn, 'users', 'scan_tier'))) {
    await conn.query(`ALTER TABLE users ADD COLUMN scan_tier ENUM('open','normal') NOT NULL DEFAULT 'normal' AFTER signup_source`);
  }
  if (!(await columnExists(conn, 'users', 'invited_by'))) {
    await conn.query('ALTER TABLE users ADD COLUMN invited_by INT UNSIGNED AFTER scan_tier');
    await conn.query('ALTER TABLE users ADD INDEX idx_users_invited_by (invited_by)');
    await conn.query('ALTER TABLE users ADD CONSTRAINT fk_users_invited_by FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL');
  }
}

// 升级路径: 已有 users 表没有 must_change_password(管理员重置密码后要求下次先改密码)。老账号取默认值 0
async function migrateUsersPasswordFlag(conn) {
  if (!(await columnExists(conn, 'users', 'must_change_password'))) {
    await conn.query('ALTER TABLE users ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0 AFTER invited_by');
  }
}

// 加入家庭的时间(转让创建者不改它；离开/被移除/解散清空)。老库没有这一列，老成员保持 NULL(不拿注册时间回填)
async function migrateUsersFamilyJoinedAt(conn) {
  if (!(await columnExists(conn, 'users', 'family_joined_at'))) {
    await conn.query('ALTER TABLE users ADD COLUMN family_joined_at TIMESTAMP NULL DEFAULT NULL AFTER family_role');
  }
}

// 初始化管理员账号: 只在 ADMIN_USERNAME/ADMIN_PASSWORD 都配置了、且该用户名还不存在时创建一次；
// 已存在的账号(不管是不是管理员)不会被覆盖密码/角色
async function seedAdmin() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) return;
  // .env.example 里的示例密码: 原样拷贝到公网部署就会创建一个人人知道密码的管理员，直接拒绝
  if (password === 'change-me-admin') {
    console.warn('[db] ADMIN_PASSWORD 还是 .env.example 里的示例值 change-me-admin，未创建管理员账号；请设置一个自己的强密码');
    return;
  }
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
      await migrateUsersInviteColumns(conn);
      await migrateUsersPasswordFlag(conn);
      await migrateUsersFamilyJoinedAt(conn);
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
// signupSource: 'open' = 开放注册(无邀请码)，同时落到 scan_tier='open' 档；缺省/其他 = 邀请注册档(列默认值)。
// 邀请码注册走 registerWithInvite()，不经过这里。
async function createUser(username, passwordHash, { familyRole, signupSource } = {}) {
  await ready;
  const open = signupSource === 'open';
  const [info] = await pool.execute(
    `INSERT INTO users (username, password_hash, family_role, signup_source, scan_tier)
     VALUES (:username, :password_hash, :family_role, :signup_source, :scan_tier)`,
    {
      username, password_hash: passwordHash, family_role: familyRole || null,
      signup_source: open ? 'open' : 'invite', scan_tier: open ? 'open' : 'normal',
    }
  );
  return info.insertId;
}

// ---- 验证码一次性 + 开放注册限速(按 IP + 全站总量) ----
// 同一个 IP 在滚动 24 小时内最多 maxAttemptsPerIpPerDay 次"过了验证码的开放注册尝试"(不论最后成没成功——用户名被占用的试探也算，
// 这样无法靠换用户名反复试探；共用出口 IP 的一家人/一个办公室也远远用不到这个数)；
// 全站再有一个总上限 maxAttemptsPerDay: 攻击者用很多不同 IP 慢速刷号时，按 IP 的限制拦不住，总量上限把"每天最多多出多少开放账号"封死
// (代价: 攻击者也能靠失败尝试把当天的名额耗光，开放注册暂时不可用，邀请码注册不受影响)。邀请码注册不受这两个限制。
// 数值在 config/config.json 的 openRegistration。
const OPEN_REG = require('../config/config.json').openRegistration;
const OPEN_SIGNUP_WINDOW_HOURS = 24;

// 记下一个验证码 token 已被使用。第一次返回 true；已经用过返回 false(INSERT 撞主键，由数据库保证并发下只有一个成功)
async function consumeCaptcha(tokenKey) {
  await ready;
  await pool.execute('DELETE FROM captcha_used WHERE created_at < NOW() - INTERVAL 10 MINUTE');
  try {
    await pool.execute('INSERT INTO captcha_used (token_key) VALUES (:tokenKey)', { tokenKey });
    return true;
  } catch (e) {
    if (e && e.code === 'ER_DUP_ENTRY') return false;
    throw e;
  }
}

// 先记一笔再数(和登录锁定、扫描额度同一个顺序)，超限就撤销自己这一笔——并发的一波请求不会各自读到 0 而全部放行。
// ip 取不到(没经 Tunnel 的本地访问)时记成空串: 只受全站总量限制，不会把所有人归进同一个"IP 桶"。
// 返回 'ok' | 'ip_limit' | 'global_limit'
async function reserveOpenSignup(ip) {
  await ready;
  const ipKey = ip ? String(ip).slice(0, 64) : '';
  await pool.execute('DELETE FROM signup_attempts WHERE created_at < NOW() - INTERVAL 2 DAY');
  const [info] = await pool.execute('INSERT INTO signup_attempts (ip) VALUES (:ip)', { ip: ipKey });
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total, COALESCE(SUM(ip = ?), 0) AS byIp FROM signup_attempts WHERE created_at > NOW() - INTERVAL ${OPEN_SIGNUP_WINDOW_HOURS} HOUR`, [ipKey]);
  let verdict = 'ok';
  if (ipKey && Number(rows[0].byIp) > OPEN_REG.maxAttemptsPerIpPerDay) verdict = 'ip_limit';
  else if (Number(rows[0].total) > OPEN_REG.maxAttemptsPerDay) verdict = 'global_limit';
  if (verdict !== 'ok') await pool.execute('DELETE FROM signup_attempts WHERE id = :id', { id: info.insertId });
  return verdict;
}

// ---- 邀请码 ----
const INVITE_VALID_DAYS = 7;
// 每人在滚动 INVITE_WINDOW_DAYS 天内最多生成这么多个码——不论用没用、作废没作废都算。
// (早先只数"未使用"的码，码一被用掉名额就空出来，等于没有频率上限，见 CLAUDE.md 里的邀请码滥用说明)
const INVITE_MAX_PER_WINDOW = 20;
const INVITE_WINDOW_DAYS = 7;

// 生成一个邀请码。familyId 非空 = 入家庭码(调用方负责确认调用者是该家庭的创建者、并且有资格发码)。
// 在事务里先锁住调用者的 users 行再数、再插入，同一用户并发生成也不会突破上限。
// 返回码行；7 天内已生成满 INVITE_MAX_PER_WINDOW 个返回 null。
async function createInviteCode(userId, { familyId } = {}) {
  await ready;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('SELECT id FROM users WHERE id = :userId FOR UPDATE', { userId });
    const [[{ n }]] = await conn.execute(`
      SELECT COUNT(*) AS n FROM invite_codes
      WHERE created_by = :userId AND created_at > NOW() - INTERVAL ${INVITE_WINDOW_DAYS} DAY
    `, { userId });
    if (n >= INVITE_MAX_PER_WINDOW) { await conn.rollback(); return null; }
    const code = crypto.randomBytes(16).toString('base64url');
    const [info] = await conn.execute(`
      INSERT INTO invite_codes (code, created_by, family_id, expires_at)
      VALUES (:code, :userId, :familyId, NOW() + INTERVAL ${INVITE_VALID_DAYS} DAY)
    `, { code, userId, familyId: familyId || null });
    const [[row]] = await conn.execute('SELECT id, code, family_id, expires_at, created_at FROM invite_codes WHERE id = :id', { id: info.insertId });
    await conn.commit();
    return row;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// 我生成的码，带状态。kind: 'family' 只列家庭码，'personal' 只列普通码，缺省全列
async function listInviteCodes(userId, kind) {
  await ready;
  const kindClause = kind === 'family' ? 'AND c.family_id IS NOT NULL' : kind === 'personal' ? 'AND c.family_id IS NULL' : '';
  const [rows] = await pool.execute(`
    SELECT c.id, c.code, c.family_id, c.expires_at, c.created_at, c.used_at, u.username AS used_by_username,
           CASE WHEN c.used_by IS NOT NULL OR c.used_at IS NOT NULL THEN 'used'
                WHEN c.revoked_at IS NOT NULL THEN 'revoked'
                WHEN c.expires_at <= NOW() THEN 'expired'
                ELSE 'unused' END AS status
    FROM invite_codes c LEFT JOIN users u ON u.id = c.used_by
    WHERE c.created_by = :userId ${kindClause}
    ORDER BY c.id DESC
  `, { userId });
  return rows;
}

// 作废自己的、还没被使用的码。返回 'ok' | 'used'(已被使用，不能改) | 'not_found'(不存在或不是你的)
async function revokeInviteCode(id, userId) {
  await ready;
  const [rows] = await pool.execute('SELECT used_by, used_at FROM invite_codes WHERE id = :id AND created_by = :userId', { id, userId });
  if (!rows.length) return 'not_found';
  const [info] = await pool.execute(`
    UPDATE invite_codes SET revoked_at = COALESCE(revoked_at, NOW())
    WHERE id = :id AND created_by = :userId AND used_by IS NULL AND used_at IS NULL
  `, { id, userId });
  return info.affectedRows > 0 ? 'ok' : 'used';
}

// 注册页预检: 码有效(未用、未作废、未过期)就返回 { id, created_by, family_id, family_name }，否则 null。
// 只读、不加锁——真正消耗码的是 registerWithInvite()，这里只是为了在建号前把表单里的家庭字段校验清楚。
async function peekInviteCode(code) {
  await ready;
  const [rows] = await pool.execute(`
    SELECT c.id, c.created_by, c.family_id, f.name AS family_name
    FROM invite_codes c LEFT JOIN families f ON f.id = c.family_id
    WHERE c.code = :code AND c.used_by IS NULL AND c.used_at IS NULL AND c.revoked_at IS NULL AND c.expires_at > NOW()
  `, { code });
  return rows[0] || null;
}

// 用邀请码建号。事务里先 SELECT ... FOR UPDATE 锁住码行，同一个码被并发注册时只有一个能成功；
// 建号、标记码已使用、(家庭码)加入家庭三件事要么全成要么全不成。
// 返回 { id, familyId, familyName, invitedBy }；码无效(不存在/已用/作废/过期)返回 null；用户名重复会抛 ER_DUP_ENTRY。
async function registerWithInvite(code, username, passwordHash, { familyRole } = {}) {
  await ready;
  const conn = await pool.getConnection();
  try {
    // 家庭码: 加锁顺序必须是"先家庭行、后邀请码行"，和解散/移除等家庭操作一致(它们先锁家庭行，再经外键级联去动邀请码行)。
    // 反过来(先锁码、再要家庭行的共享锁)会和解散互相死锁(验证中复现过)。所以先不加锁地读出这个码属于哪个家庭，
    // 开事务后先拿该家庭行的共享锁，再锁码行并重新核对码还有效、还是同一个家庭(不是就放锁重来)。
    for (let attempt = 0; ; attempt++) {
      const [peek] = await conn.execute('SELECT family_id FROM invite_codes WHERE code = :code', { code });
      const guessFamily = (peek[0] && peek[0].family_id) || null;
      await conn.beginTransaction();
      if (guessFamily) {
        const [f] = await conn.execute('SELECT id FROM families WHERE id = :fid FOR SHARE', { fid: guessFamily });
        if (!f.length) { await conn.rollback(); return null; } // 家庭已被解散，码随之失效
      }
      const [rows] = await conn.execute(`
        SELECT c.id, c.created_by, c.family_id, f.name AS family_name
        FROM invite_codes c LEFT JOIN families f ON f.id = c.family_id
        WHERE c.code = :code AND c.used_by IS NULL AND c.used_at IS NULL AND c.revoked_at IS NULL AND c.expires_at > NOW()
        FOR UPDATE
      `, { code });
      if (!rows.length) { await conn.rollback(); return null; }
      const c = rows[0];
      if ((c.family_id || null) !== guessFamily) {
        await conn.rollback();
        if (attempt >= 4) throw new Error('邀请码状态持续变化，请稍后重试');
        continue;
      }
      const [info] = await conn.execute(`
        INSERT INTO users (username, password_hash, family_role, signup_source, scan_tier, invited_by, family_id, family_joined_at, account_type)
        VALUES (:username, :password_hash, :family_role, 'invite', 'normal', :invited_by, :family_id, IF(:family_id IS NULL, NULL, NOW()), :account_type)
      `, {
        username, password_hash: passwordHash, family_role: familyRole || null, invited_by: c.created_by,
        family_id: c.family_id || null, account_type: c.family_id ? 'family' : 'individual',
      });
      await conn.execute('UPDATE invite_codes SET used_by = :uid, used_at = NOW() WHERE id = :id', { uid: info.insertId, id: c.id });
      await conn.commit();
      return { id: info.insertId, familyId: c.family_id || null, familyName: c.family_name || null, invitedBy: c.created_by };
    }
  } catch (e) {
    try { await conn.rollback(); } catch (_) { /* 没有进行中的事务 */ }
    throw e;
  } finally {
    conn.release();
  }
}

// ---- 扫描额度 / scan_log ----
const SCAN_WINDOW_HOURS = 24; // 滚动 24 小时，不按自然日(避开时区)

// 先记一条再数、超限就撤回自己那条(和登录防爆破同样的顺序): 并发到达的请求都能看到彼此已写入的记录，
// 保证任何 24 小时窗口里放行的次数不超过 limit。limit 为 null = 不限额(管理员)，只记录。
// 返回 { ok: true, id } 放行(之后用 finishScan 记成败)，或 { ok: false, used } 超额(已撤回，不留记录)。
async function reserveScan(userId, model, limit, openGlobalLimit = null) {
  await ready;
  const [info] = await pool.execute('INSERT INTO scan_log (user_id, model) VALUES (:userId, :model)', { userId, model: model || null });
  if (limit != null) {
    const [[{ n }]] = await pool.execute(`
      SELECT COUNT(*) AS n FROM scan_log WHERE user_id = :userId AND created_at > NOW() - INTERVAL ${SCAN_WINDOW_HOURS} HOUR
    `, { userId });
    if (n > limit) {
      await pool.execute('DELETE FROM scan_log WHERE id = :id', { id: info.insertId });
      return { ok: false, used: Math.min(n - 1, limit) };
    }
  }
  // 全站开放档(open 档、非管理员)账号的识别总预算: 每个开放账号每天 3 次，账号多了总花费也要有上限(config openRegistration.maxOpenScansPerDay)
  if (openGlobalLimit != null) {
    const [[{ n }]] = await pool.execute(`
      SELECT COUNT(*) AS n FROM scan_log s JOIN users u ON u.id = s.user_id
      WHERE u.scan_tier = 'open' AND u.is_admin = 0 AND s.created_at > NOW() - INTERVAL ${SCAN_WINDOW_HOURS} HOUR
    `);
    if (n > openGlobalLimit) {
      await pool.execute('DELETE FROM scan_log WHERE id = :id', { id: info.insertId });
      return { ok: false, global: true };
    }
  }
  return { ok: true, id: info.insertId };
}

async function finishScan(id, success) {
  await ready;
  await pool.execute('UPDATE scan_log SET success = :success WHERE id = :id', { id, success: success ? 1 : 0 });
}

// 管理员调整某用户的额度档位。返回 false = 用户不存在。
// 降到 open 档时，顺手作废该用户手里所有还没被使用的邀请码——降级的目的就是阻止他继续拉人(见 invites 路由的说明)，
// 如果不作废，一个被发现在刷码的账号还能靠手里最多 20 个有效码再拉 7 天的人。已被使用的码不受影响(那些人已经注册了)。
// audit: { id, username }(操作的管理员)。给了就在同一事务里写一条 set_tier 日志；用户不存在返回 false、不写日志
async function setScanTier(userId, tier, audit) {
  await ready;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute('SELECT username, scan_tier FROM users WHERE id = :userId FOR UPDATE', { userId });
    if (!rows.length) { await conn.rollback(); return false; }
    if (rows[0].scan_tier === tier) { await conn.rollback(); return true; } // 没有发生写入就不写审计日志
    await conn.execute('UPDATE users SET scan_tier = :tier WHERE id = :userId', { userId, tier });
    if (tier === 'open') {
      await conn.execute(`
        UPDATE invite_codes SET revoked_at = NOW()
        WHERE created_by = :userId AND used_by IS NULL AND used_at IS NULL AND revoked_at IS NULL
      `, { userId });
    }
    if (audit) {
      await insertAudit(conn, audit, { action: 'set_tier', target_type: 'user', target_id: userId, target_label: rows[0].username, detail: `额度档位 ${rows[0].scan_tier} → ${tier}` });
    }
    await conn.commit();
    return true;
  } catch (e) {
    try { await conn.rollback(); } catch (_) { /* 没有进行中的事务 */ }
    throw e;
  } finally {
    conn.release();
  }
}

// ---- 管理员操作日志 ----
// 在调用方的事务里写一行。audit = { id, username }(操作的管理员)，d = { action, target_type, target_id, target_label, detail }
async function insertAudit(conn, audit, d) {
  await conn.execute(`
    INSERT INTO admin_audit_log (admin_id, admin_username, action, target_type, target_id, target_label, detail)
    VALUES (:admin_id, :admin_username, :action, :target_type, :target_id, :target_label, :detail)
  `, {
    admin_id: audit.id, admin_username: String(audit.username).slice(0, 100),
    action: d.action, target_type: d.target_type, target_id: d.target_id,
    target_label: String(d.target_label).slice(0, 255), detail: d.detail ? String(d.detail).slice(0, 255) : null,
  });
}

async function listAuditLog({ limit = 200 } = {}) {
  await ready;
  const lim = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 500);
  const [rows] = await pool.execute(`SELECT * FROM admin_audit_log ORDER BY id DESC LIMIT ${lim}`);
  return rows;
}

// 管理员把某用户的密码重置成临时密码(hash 由调用方生成)，并要求该用户下次先改密码。
// 返回 'ok' | 'not_found' | 'is_admin'(管理员账号的密码来自 .env 引导，不能被重置)。同一事务里写 reset_password 日志(不含密码)
async function resetUserPassword(userId, passwordHash, audit) {
  await ready;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute('SELECT username, is_admin FROM users WHERE id = :userId FOR UPDATE', { userId });
    if (!rows.length) { await conn.rollback(); return 'not_found'; }
    if (rows[0].is_admin) { await conn.rollback(); return 'is_admin'; }
    await conn.execute('UPDATE users SET password_hash = :passwordHash, must_change_password = 1 WHERE id = :userId', { passwordHash, userId });
    // 重置同时解除"输密码确认"的锁，否则用户拿着新的临时密码去改密码还会被之前的错误次数挡 15 分钟
    await conn.execute('DELETE FROM pw_failures WHERE user_id = :userId', { userId });
    await insertAudit(conn, audit, { action: 'reset_password', target_type: 'user', target_id: userId, target_label: rows[0].username, detail: '重置为临时密码，下次登录须先修改' });
    await conn.commit();
    return 'ok';
  } catch (e) {
    try { await conn.rollback(); } catch (_) { /* 没有进行中的事务 */ }
    throw e;
  } finally {
    conn.release();
  }
}

// 管理员删除小票，并在同一事务里写 delete_receipt 日志。返回受影响行数(0 = 不存在，不写日志)
async function adminDeleteReceipt(id, audit) {
  await ready;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute(`
      SELECT r.store, r.purchased_at, r.total, u.username AS owner
      FROM receipts r LEFT JOIN users u ON u.id = r.user_id WHERE r.id = :id FOR UPDATE OF r
    `, { id });  // OF r: 只锁小票行；不锁所有者的 users 行(那会和"先家庭行、后用户行"的加锁顺序相反，压测里出现过死锁)
    if (!rows.length) { await conn.rollback(); return 0; }
    const r = rows[0];
    const [result] = await conn.execute('DELETE FROM receipts WHERE id = :id', { id });
    await insertAudit(conn, audit, {
      action: 'delete_receipt', target_type: 'receipt', target_id: id,
      target_label: `${r.store} ${r.purchased_at} $${Number(r.total).toFixed(2)}`, detail: r.owner ? `所有者: ${r.owner}` : null,
    });
    await conn.commit();
    return result.affectedRows;
  } catch (e) {
    try { await conn.rollback(); } catch (_) { /* 没有进行中的事务 */ }
    throw e;
  } finally {
    conn.release();
  }
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

// 创建家庭，创建者本人立即成为成员(唯一有权邀请/审核的人)。
// 创建者已经在某个家庭里(例如并发的邀请/批准刚把他拉进去)返回 null，不覆盖他现有的家庭归属
async function createFamily(name, creatorId) {
  await ready;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [info] = await conn.execute('INSERT INTO families (name, creator_id) VALUES (:name, :creator_id)', { name, creator_id: creatorId });
    const familyId = info.insertId;
    const [upd] = await conn.execute(
      `UPDATE users SET family_id = :familyId, family_joined_at = NOW(), account_type = 'family' WHERE id = :creatorId AND family_id IS NULL`,
      { familyId, creatorId }
    );
    if (upd.affectedRows === 0) { await conn.rollback(); return null; }
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
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // 先家庭行(共享锁)、后用户行——与解散/移除同序，避免和它们死锁；家庭已被解散则邀请失败
    const [f] = await conn.execute('SELECT id FROM families WHERE id = :familyId FOR SHARE', { familyId });
    if (!f.length) { await conn.rollback(); return false; }
    const [result] = await conn.execute(
      `UPDATE users SET family_id = :familyId, family_joined_at = NOW(), account_type = 'family' WHERE username = :username AND family_id IS NULL`,
      { familyId, username }
    );
    await conn.commit();
    return result.affectedRows > 0;
  } catch (e) {
    try { await conn.rollback(); } catch (_) { /* 没有进行中的事务 */ }
    throw e;
  } finally {
    conn.release();
  }
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

// ---- 家庭管理(退出 / 移除 / 转让 / 解散 / 改名 / 撤回申请) ----
// 所有会改动家庭成员关系的操作都在事务里、并且**先锁 families 行再锁 users 行**(统一的加锁顺序，避免死锁)；
// 锁住家庭行之后再校验调用者当前是不是创建者，这样"同时转让 + 移除 / 同时退出"这类并发不会各自基于过期状态做决定。
// 返回值是状态字符串，由路由映射成 HTTP 状态码。

// 把一个用户从家庭里摘出来: 变回个人账号；他名下的小票和明细 family_id/family_name 清空(小票跟人走，所有者不变)
async function detachUser(conn, userId) {
  await conn.execute(
    `UPDATE receipts SET family_id = NULL, family_name = NULL, account_type = 'individual' WHERE user_id = :userId AND family_id IS NOT NULL`,
    { userId }
  );
  await conn.execute(`
    UPDATE items i JOIN receipts r ON r.id = i.receipt_id
    SET i.family_id = NULL, i.family_name = NULL, i.account_type = 'individual'
    WHERE r.user_id = :userId AND i.family_id IS NOT NULL
  `, { userId });
  await conn.execute(`UPDATE users SET family_id = NULL, family_joined_at = NULL, account_type = 'individual' WHERE id = :userId`, { userId });
}

// 解散: 所有成员变回个人、全部小票/明细摘掉家庭归属，然后删家庭(待审申请和家庭邀请码由外键级联一并删除)
async function dissolveInTx(conn, familyId) {
  await conn.execute(
    `UPDATE receipts SET family_id = NULL, family_name = NULL, account_type = 'individual' WHERE family_id = :familyId`, { familyId });
  await conn.execute(
    `UPDATE items SET family_id = NULL, family_name = NULL, account_type = 'individual' WHERE family_id = :familyId`, { familyId });
  await conn.execute(`UPDATE users SET family_id = NULL, family_joined_at = NULL, account_type = 'individual' WHERE family_id = :familyId`, { familyId });
  await conn.execute('DELETE FROM families WHERE id = :familyId', { familyId });
}

// 锁住家庭行并返回它(不存在返回 null)
async function lockFamily(conn, familyId) {
  const [rows] = await conn.execute('SELECT id, name, creator_id FROM families WHERE id = :familyId FOR UPDATE', { familyId });
  return rows[0] || null;
}

// 成员自己退出。返回 'left' | 'dissolved'(创建者且只剩自己，退出即解散) | 'not_in_family' | 'creator_must_transfer'
async function leaveFamily(userId) {
  await ready;
  const [pre] = await pool.execute('SELECT family_id FROM users WHERE id = :userId', { userId });
  const familyId = pre[0] && pre[0].family_id;
  if (!familyId) return 'not_in_family';
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const family = await lockFamily(conn, familyId);
    // 拿到家庭锁之后重新确认: 等锁期间他可能已经被移除 / 已经退出 / 家庭已解散
    const [[u]] = await conn.execute('SELECT family_id FROM users WHERE id = :userId FOR UPDATE', { userId });
    if (!family || !u || u.family_id !== familyId) { await conn.rollback(); return 'not_in_family'; }
    if (family.creator_id === userId) {
      const [[{ n }]] = await conn.execute('SELECT COUNT(*) AS n FROM users WHERE family_id = :familyId', { familyId });
      if (n > 1) { await conn.rollback(); return 'creator_must_transfer'; }
      await dissolveInTx(conn, familyId);
      await conn.commit();
      return 'dissolved';
    }
    await detachUser(conn, userId);
    await conn.commit();
    return 'left';
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// 创建者移除成员。返回 'removed' | 'forbidden'(调用者已不是创建者) | 'is_creator'(目标是创建者本人) | 'not_member'
async function removeMember(familyId, callerId, targetId) {
  await ready;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const family = await lockFamily(conn, familyId);
    if (!family || family.creator_id !== callerId) { await conn.rollback(); return 'forbidden'; }
    if (targetId === callerId) { await conn.rollback(); return 'is_creator'; }
    const [[t]] = await conn.execute('SELECT family_id FROM users WHERE id = :targetId FOR UPDATE', { targetId });
    if (!t || t.family_id !== familyId) { await conn.rollback(); return 'not_member'; }
    await detachUser(conn, targetId);
    await conn.commit();
    return 'removed';
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// 转让创建者身份给本家庭的另一个成员；原创建者未使用的家庭邀请码同时作废(他不再有权拉人进这个家庭)。
// 返回 'transferred' | 'forbidden' | 'self' | 'not_member'
async function transferCreator(familyId, callerId, newCreatorId) {
  await ready;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const family = await lockFamily(conn, familyId);
    if (!family || family.creator_id !== callerId) { await conn.rollback(); return 'forbidden'; }
    if (newCreatorId === callerId) { await conn.rollback(); return 'self'; }
    const [[t]] = await conn.execute('SELECT family_id FROM users WHERE id = :newCreatorId FOR UPDATE', { newCreatorId });
    if (!t || t.family_id !== familyId) { await conn.rollback(); return 'not_member'; }
    await conn.execute('UPDATE families SET creator_id = :newCreatorId WHERE id = :familyId', { newCreatorId, familyId });
    await conn.execute(`
      UPDATE invite_codes SET revoked_at = NOW()
      WHERE created_by = :callerId AND family_id = :familyId AND used_by IS NULL AND used_at IS NULL AND revoked_at IS NULL
    `, { callerId, familyId });
    await conn.commit();
    return 'transferred';
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// 创建者解散家庭。confirmName 必须和家庭名一字不差(防止手滑/误调)。返回 'dissolved' | 'forbidden' | 'name_mismatch'
async function dissolveFamily(familyId, callerId, confirmName) {
  await ready;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const family = await lockFamily(conn, familyId);
    if (!family || family.creator_id !== callerId) { await conn.rollback(); return 'forbidden'; }
    if (family.name !== confirmName) { await conn.rollback(); return 'name_mismatch'; }
    await dissolveInTx(conn, familyId);
    await conn.commit();
    return 'dissolved';
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// 创建者改名(全站唯一)。历史小票/明细里冗余存的 family_name 一并更新。返回 'renamed' | 'forbidden' | 'name_taken'
async function renameFamily(familyId, callerId, newName) {
  await ready;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const family = await lockFamily(conn, familyId);
    if (!family || family.creator_id !== callerId) { await conn.rollback(); return 'forbidden'; }
    if (family.name !== newName) {
      try {
        await conn.execute('UPDATE families SET name = :newName WHERE id = :familyId', { newName, familyId });
      } catch (e) {
        await conn.rollback();
        if (e && e.code === 'ER_DUP_ENTRY') return 'name_taken';
        throw e;
      }
      await conn.execute('UPDATE receipts SET family_name = :newName WHERE family_id = :familyId', { newName, familyId });
      await conn.execute('UPDATE items SET family_name = :newName WHERE family_id = :familyId', { newName, familyId });
    }
    await conn.commit();
    return 'renamed';
  } catch (e) {
    try { await conn.rollback(); } catch (_) { /* 上面已回滚过 */ }
    throw e;
  } finally {
    conn.release();
  }
}

// 申请人撤回自己还没被处理的申请(直接删除这条记录)。别人的、已处理的、不存在的都返回 false
async function withdrawApplication(requestId, userId) {
  await ready;
  const [info] = await pool.execute(
    `DELETE FROM family_join_requests WHERE id = :requestId AND user_id = :userId AND status = 'pending'`,
    { requestId, userId }
  );
  return info.affectedRows > 0;
}

// 我提交的、还在等审核的申请(带家庭名)
async function listMyApplications(userId) {
  await ready;
  const [rows] = await pool.execute(`
    SELECT fjr.id, f.name AS family_name, fjr.created_at
    FROM family_join_requests fjr JOIN families f ON f.id = fjr.family_id
    WHERE fjr.user_id = :userId AND fjr.status = 'pending'
    ORDER BY fjr.created_at
  `, { userId });
  return rows;
}

async function listFamilyMembers(familyId) {
  await ready;
  const [rows] = await pool.execute(
    'SELECT id, username, family_role, family_joined_at, created_at FROM users WHERE family_id = :familyId ORDER BY created_at',
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
// 创建者批准/拒绝一条加入申请。返回 true = 已处理；false = 申请不存在/已处理/不属于这个家庭；
// 'forbidden' = callerId 给了、但在事务里核对时已经不是这个家庭的创建者(刚转让走了)；
// 'applicant_in_family' = 批准时申请人已经加入了别的家庭(这条申请按"拒绝"收尾，不再谎报成功)。
// 加锁顺序: 先家庭行(共享锁，创建者变更/解散要它的排他锁，会等这个事务)，再申请行、用户行。
// (和"删除申请人账号"仍是相反的顺序——后者先锁用户行、再经外键级联动申请行，压测里会死锁，由 DEADLOCK_RETRY 重试兜底。)
async function decideRequest(requestId, familyId, approve, callerId) {
  await ready;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [f] = await conn.execute('SELECT id, creator_id FROM families WHERE id = :familyId FOR SHARE', { familyId });
    if (!f.length) { await conn.rollback(); return false; }
    if (callerId != null && f[0].creator_id !== callerId) { await conn.rollback(); return 'forbidden'; }
    const [rows] = await conn.execute(
      `SELECT * FROM family_join_requests WHERE id = :requestId AND family_id = :familyId AND status = 'pending' FOR UPDATE`,
      { requestId, familyId }
    );
    const reqRow = rows[0];
    if (!reqRow) { await conn.rollback(); return false; }
    let result = true;
    let status = approve ? 'approved' : 'rejected';
    if (approve) {
      const [upd] = await conn.execute(
        `UPDATE users SET family_id = :familyId, family_joined_at = NOW(), account_type = 'family' WHERE id = :userId AND family_id IS NULL`,
        { familyId, userId: reqRow.user_id }
      );
      if (upd.affectedRows === 0) { status = 'rejected'; result = 'applicant_in_family'; }
    }
    await conn.execute(
      `UPDATE family_join_requests SET status = :status, decided_at = NOW() WHERE id = :requestId`,
      { requestId, status }
    );
    await conn.commit();
    return result;
  } catch (e) {
    try { await conn.rollback(); } catch (_) { /* 没有进行中的事务 */ }
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
    SELECT u.id, u.username, u.is_admin, u.family_id, u.family_role, u.account_type, u.scan_tier, u.must_change_password,
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
    // 库的默认排序规则不区分大小写，文件名是区分大小写的随机串；先走索引，再按字节精确比对
    'SELECT user_id, family_id FROM receipts WHERE image_file = :imageFile AND BINARY image_file = BINARY :imageFile LIMIT 1',
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
  // 顺手清掉一天前的旧记录，表不会无限增长。先清旧记录、最后才 INSERT: 本函数在 DEADLOCK_RETRY 里，两条语句各自自动提交，
  // 如果 INSERT 已提交、后面的 DELETE 才死锁，重试就会多插一条失败记录(与 recordPasswordFailure 同一个顺序)
  await pool.execute('DELETE FROM login_failures WHERE created_at < NOW() - INTERVAL 1 DAY');
  const [info] = await pool.execute(
    'INSERT INTO login_failures (username, ip) VALUES (:username, :ip)',
    { username: lfUser(username), ip: lfIp(ip) }
  );
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

// ---- "输密码确认"接口的防爆破(src/passwordGuard.js)，语义与登录锁定相同，只是按 user_id、存在 pw_failures ----
// 固定时长锁定: 最近一次失败 L(须在 windowMinutes 内)，若 (L - window, L] 内失败数 >= max 就锁到 L + window；锁定期间不写记录
async function isPasswordLocked(userId, max, windowMinutes) {
  await ready;
  const [rows] = await pool.execute(`
    SELECT COUNT(*) AS n
    FROM pw_failures f
    JOIN (SELECT MAX(created_at) AS m FROM pw_failures
          WHERE user_id = :userId AND created_at > NOW() - INTERVAL :windowMinutes MINUTE) last
      ON f.created_at > last.m - INTERVAL :windowMinutes MINUTE AND f.created_at <= last.m
    WHERE f.user_id = :userId
  `, { userId, windowMinutes });
  return Number(rows[0].n) >= max;
}
async function recordPasswordFailure(userId) {
  await ready;
  // 先清旧记录、最后才 INSERT: 本函数在 DEADLOCK_RETRY 里，两条语句各自自动提交，如果 INSERT 已提交、后面的 DELETE 才死锁，
  // 重试就会多插一条失败记录。把 INSERT 放最后，任何一次重试都发生在 INSERT 提交之前
  await pool.execute('DELETE FROM pw_failures WHERE created_at < NOW() - INTERVAL 1 DAY');
  const [info] = await pool.execute('INSERT INTO pw_failures (user_id) VALUES (:userId)', { userId });
  return info.insertId;
}
async function countPasswordFailures(userId, windowMinutes) {
  await ready;
  const [rows] = await pool.execute(
    'SELECT COUNT(*) AS n FROM pw_failures WHERE user_id = :userId AND created_at > NOW() - INTERVAL :windowMinutes MINUTE', { userId, windowMinutes });
  return Number(rows[0].n);
}
async function deletePasswordFailure(id) {
  await ready;
  await pool.execute('DELETE FROM pw_failures WHERE id = :id', { id });
}
async function clearPasswordFailures(userId) {
  await ready;
  await pool.execute('DELETE FROM pw_failures WHERE user_id = :userId', { userId });
}

async function updatePassword(id, passwordHash) {
  await ready;
  // 改密码同时清掉"必须先改密码"标志(管理员重置后用户第一次改密码就解除)
  await pool.execute('UPDATE users SET password_hash = :password_hash, must_change_password = 0 WHERE id = :id', { id, password_hash: passwordHash });
}

// 迁移: 把功能上线前的无主小票全部归给首个注册账号
async function backfillOwnerlessReceipts(userId) {
  await ready;
  const [result] = await pool.execute('UPDATE receipts SET user_id = :userId WHERE user_id IS NULL', { userId });
  return result.affectedRows;
}

// ---- 写入 ----
// receipt.family_id/family_name/family_role/account_type: 建票时从上传者当前的 users 行拷贝下来的冗余字段，
// 目的是家庭内可见性/统计能直接按 receipts/items 的列过滤或分组，不必每次 JOIN users。
//   默认(不传 opts): 用调用方给的值，不传就落到"个人账号"默认值——测试和脚本用。
//   { stampFamilyFromDb: true }(路由用): **忽略调用方给的家庭字段，在事务里从数据库取当前值**。
//     路由是在解析完(可能 16 MB 的)请求体之前读的会话，如果这期间发生了退出/移除/改名/解散，
//     用会话里的旧值写入就会留下一张"家庭归属已经过期"的小票: 仍然对旧家庭可见、或带着旧家庭名、
//     或(家庭已解散时)因外键失败变成 500。这里先拿到该家庭行的共享锁(家庭管理操作都要先拿它的排他锁，
//     所以会等本事务提交)，再用锁定读核对用户当前所属家庭；等锁期间变了就重来。
async function saveReceipt(receipt, items, { stampFamilyFromDb = false } = {}) {
  await ready;
  const conn = await pool.getConnection();
  try {
    let fam = {
      family_id: receipt.family_id ?? null, family_name: receipt.family_name ?? null,
      family_role: receipt.family_role ?? null, account_type: receipt.account_type || 'individual',
    };
    let rid;
    for (let attempt = 0; ; attempt++) {
      // 先在事务外(自动提交)读一次，避免事务快照读到旧值
      let guess = null;
      if (stampFamilyFromDb) {
        const [pre] = await conn.execute('SELECT family_id FROM users WHERE id = :uid', { uid: receipt.user_id });
        guess = (pre[0] && pre[0].family_id) || null;
      }
      await conn.beginTransaction();
      if (stampFamilyFromDb) {
        let famName = null;
        if (guess) {
          const [f] = await conn.execute('SELECT id, name FROM families WHERE id = :fid FOR SHARE', { fid: guess });
          famName = f[0] ? f[0].name : null;
          if (!f[0]) guess = null; // 家庭已被解散
        }
        const [u] = await conn.execute('SELECT family_id, family_role FROM users WHERE id = :uid FOR SHARE', { uid: receipt.user_id });
        const current = (u[0] && u[0].family_id) || null;
        if (current !== guess) {
          // 等锁期间成员关系变了: 放掉锁，按最新的再来(最多几次，实际上一次就稳定)
          await conn.rollback();
          if (attempt >= 4) throw new Error('保存小票时家庭关系持续变化，请稍后重试');
          continue;
        }
        fam = {
          family_id: guess, family_name: guess ? famName : null,
          family_role: (u[0] && u[0].family_role) || null, account_type: guess ? 'family' : 'individual',
        };
      }
      const [info] = await conn.execute(`
        INSERT INTO receipts (user_id, family_id, family_name, family_role, account_type, store, purchased_at, currency, subtotal, gst, pst, total, image_file, raw_json)
        VALUES (:user_id, :family_id, :family_name, :family_role, :account_type, :store, :purchased_at, :currency, :subtotal, :gst, :pst, :total, :image_file, :raw_json)
      `, { ...receipt, ...fam });
      rid = info.insertId;
      for (const it of items) {
        await conn.execute(`
          INSERT INTO items (receipt_id, family_id, family_name, family_role, account_type, name_raw, name_norm, category, subcategory, qty, unit, unit_price, amount, taxable)
          VALUES (:receipt_id, :family_id, :family_name, :family_role, :account_type, :name_raw, :name_norm, :category, :subcategory, :qty, :unit, :unit_price, :amount, :taxable)
        `, { ...it, receipt_id: rid, ...fam });
      }
      await conn.commit();
      return rid;
    }
  } catch (e) {
    try { await conn.rollback(); } catch (_) { /* 没有进行中的事务 */ }
    throw e;
  } finally {
    conn.release();
  }
}

// ---- 查询 ----
// scope: { familyId, userId } 在家庭里的成员: 看得到整个家庭以家庭身份保存的小票，**外加自己的所有小票**
//          (r.family_id = :familyId OR r.user_id = :userId)。后半句很重要: 加入/创建家庭之前记的个人小票没有
//          family_id，如果只按 family_id 过滤，这些旧小票会从本人视图里消失；而别人的旧个人小票
//          (别人的 user_id、family_id 为空)两个条件都不满足，仍然保持私有，不会共享给家庭。
//        { familyId } 只按家庭(只在调用方没带 userId 时用，兼容旧调用)；
//        { userId } 只看自己(个人账号，或未在家庭里)；
//        都不传(管理后台用)则不加这个过滤，查全部用户
// 把 scope 变成 WHERE 片段(不含 WHERE/AND)，需要的参数写进 params；没有任何限定返回 ''
function scopeClause(scope, params) {
  if (!scope) return '';
  if (scope.familyId && scope.userId) {
    params.familyId = scope.familyId;
    params.userId = scope.userId;
    return '(r.family_id = :familyId OR r.user_id = :userId)';
  }
  if (scope.familyId) { params.familyId = scope.familyId; return 'r.family_id = :familyId'; }
  if (scope.userId) { params.userId = scope.userId; return 'r.user_id = :userId'; }
  return '';
}

function dateFilter(from, to, scope) {
  const clauses = [];
  const params = {};
  const sc = scopeClause(scope, params);
  if (sc) clauses.push(sc);
  if (from) { clauses.push('r.purchased_at >= :from'); params.from = from; }
  if (to)   { clauses.push('r.purchased_at <= :to');   params.to = to; }
  return { where: clauses.length ? 'WHERE ' + clauses.join(' AND ') : '', params };
}

// LIKE 里的 % _ \\ 当成普通字符(MySQL 默认转义符就是反斜杠)
const likeEscape = (s) => String(s).replace(/[\\%_]/g, '\\$&');

async function listReceipts({ limit = 200, from, to, search, scope } = {}) {
  await ready;
  const lim = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 2000);
  const { where, params } = dateFilter(from, to, scope);
  const clauses = where ? [where.slice('WHERE '.length)] : [];
  if (search) {
    clauses.push(`(r.store LIKE :search OR EXISTS (
      SELECT 1 FROM items i2 WHERE i2.receipt_id = r.id AND (i2.name_raw LIKE :search OR i2.name_norm LIKE :search)
    ))`);
    params.search = '%' + likeEscape(search) + '%';
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
  const sc = scopeClause(scope, params);
  if (sc) clause += ' AND ' + sc;
  const [rows] = await pool.execute(`
    SELECT r.*, u.username AS owner_username FROM receipts r LEFT JOIN users u ON u.id = r.user_id WHERE ${clause}
  `, params);
  const r = rows[0];
  if (!r) return null;
  const [items] = await pool.execute('SELECT * FROM items WHERE receipt_id = :id ORDER BY id', { id });
  r.items = items;
  return r;
}

// 保存后编辑: 只有小票的所有者能改，不存在或不是自己的返回 false。
// 加锁顺序与家庭管理操作一致——先家庭行、后小票行、再明细: 新明细带 family_id 外键，插入时会对 families 行加共享锁，
// 如果先锁了小票行再去要家庭行，就会和"先锁家庭行、再更新小票"的改名/解散/移除互相死锁(验证中复现过)。
// 所以先在事务外读出小票当前的 family_id，开事务后先拿该家庭行的共享锁(家庭管理要它的排他锁，会等本事务)，
// 再锁小票行并核对 family_id 没变(变了就放锁重来)。
// 只更新 store/purchased_at/subtotal/gst/pst/total，整体替换明细；image_file、raw_json、currency、小票的 family_* 都不动。
async function updateReceipt(id, userId, receipt, items) {
  await ready;
  const conn = await pool.getConnection();
  try {
    for (let attempt = 0; ; attempt++) {
      const [pre] = await conn.execute('SELECT family_id FROM receipts WHERE id = :id AND user_id = :userId', { id, userId });
      if (!pre[0]) return false;
      const guess = pre[0].family_id || null;
      await conn.beginTransaction();
      if (guess) await conn.execute('SELECT id FROM families WHERE id = :fid FOR SHARE', { fid: guess });
      const [rows] = await conn.execute(
        `SELECT family_id, family_name, family_role, account_type FROM receipts WHERE id = :id AND user_id = :userId FOR UPDATE`,
        { id, userId }
      );
      if (!rows[0]) { await conn.rollback(); return false; }
      if ((rows[0].family_id || null) !== guess) {
        await conn.rollback();
        if (attempt >= 4) throw new Error('保存小票时家庭关系持续变化，请稍后重试');
        continue;
      }
      const fam = rows[0];
      await conn.execute(`
        UPDATE receipts SET store = :store, purchased_at = :purchased_at, subtotal = :subtotal, gst = :gst, pst = :pst, total = :total
        WHERE id = :id
      `, { store: receipt.store, purchased_at: receipt.purchased_at, subtotal: receipt.subtotal, gst: receipt.gst, pst: receipt.pst, total: receipt.total, id });
      await conn.execute('DELETE FROM items WHERE receipt_id = :id', { id });
      for (const it of items) {
        await conn.execute(`
          INSERT INTO items (receipt_id, family_id, family_name, family_role, account_type, name_raw, name_norm, category, subcategory, qty, unit, unit_price, amount, taxable)
          VALUES (:receipt_id, :family_id, :family_name, :family_role, :account_type, :name_raw, :name_norm, :category, :subcategory, :qty, :unit, :unit_price, :amount, :taxable)
        `, { ...it, receipt_id: id, ...fam });
      }
      await conn.commit();
      return true;
    }
  } catch (e) {
    try { await conn.rollback(); } catch (_) { /* 没有进行中的事务 */ }
    throw e;
  } finally {
    conn.release();
  }
}

// 重复提示: 在可见范围内(家庭 + 自己的，或只有自己的)找同商家(忽略首尾空格和大小写)、同日期、同总额的小票。
// 只用于提示，不拦截保存。
async function findDuplicateReceipts({ store, purchased_at, total }, scope) {
  await ready;
  const params = { store: String(store).trim(), purchased_at, total: Number(total).toFixed(2) };
  const sc = scopeClause(scope, params);
  const [rows] = await pool.execute(`
    SELECT r.id, r.store, r.purchased_at, r.total, r.created_at, u.username AS owner_username
    FROM receipts r LEFT JOIN users u ON u.id = r.user_id
    WHERE TRIM(r.store) = :store AND r.purchased_at = :purchased_at AND r.total = CAST(:total AS DECIMAL(10,2))
    ${sc ? 'AND ' + sc : ''}
    ORDER BY r.id DESC LIMIT 5
  `, params);
  return rows;
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
  const params = { q: '%' + likeEscape(nameNorm) + '%' };
  const scopeSql = scopeClause(scope, params) || '1 = 0'; // 没有 scope 就什么都不返回(这个函数从不给管理后台用)
  let storeClause = '';
  if (store) { storeClause = ' AND r.store = :store'; params.store = store; }
  const [rows] = await pool.execute(`
    SELECT r.purchased_at AS date, r.store AS store,
           i.name_raw AS name, i.unit, i.qty,
           i.unit_price AS unit_price, i.amount AS amount
    FROM items i JOIN receipts r ON r.id = i.receipt_id
    WHERE ${scopeSql} AND (i.name_norm LIKE :q OR i.name_raw LIKE :q)${storeClause}
    ORDER BY r.purchased_at
  `, params);
  return rows;
}

// 品名候选(用于趋势搜索下拉); scope 语义同 dateFilter
async function distinctItemNames(scope) {
  await ready;
  const params = {};
  const scopeSql = scopeClause(scope, params) || '1 = 0';
  const [rows] = await pool.execute(`
    SELECT COALESCE(i.name_norm, i.name_raw) AS name, COUNT(*) AS n
    FROM items i JOIN receipts r ON r.id = i.receipt_id
    WHERE ${scopeSql}
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
    SELECT u.id, u.username, u.is_admin, u.account_type, u.family_role, f.name AS family_name, (f.creator_id = u.id) AS is_family_creator, u.created_at,
           u.signup_source, u.scan_tier, inv.username AS inviter_username,
           COUNT(r.id) AS receipt_count,
           ROUND(COALESCE(SUM(r.total), 0), 2) AS total_spend
    FROM users u
    LEFT JOIN receipts r ON r.user_id = u.id
    LEFT JOIN families f ON f.id = u.family_id
    LEFT JOIN users inv ON inv.id = u.invited_by
    GROUP BY u.id, u.username, u.is_admin, u.account_type, u.family_role, f.name, f.creator_id, u.created_at,
             u.signup_source, u.scan_tier, inv.username
    ORDER BY u.created_at
  `);
  return rows;
}

// 删除用户(管理员用)。如果他是某个家庭的创建者，families.creator_id 的外键会级联删掉整个家庭，
// 但成员的 account_type 和小票/明细里冗余的 family_name 不会跟着清理——所以先走一遍和"解散家庭"相同的清理，
// 让其他成员干净地变回个人账号、小票归各自所有，再删这个用户。
// 管理员删除账号(级联删除其小票/明细)。先解散该用户创建的家庭，其他成员变回个人。
// 返回 { deleted: 受影响行数, images: 被删小票的原图文件名 }——文件在数据库事务提交之后由调用方删除。
// audit 给了就在同一事务里写 delete_user 日志(账号不存在不写)
async function deleteUserFull(id, audit) {
  await ready;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [owned] = await conn.execute('SELECT id FROM families WHERE creator_id = :id FOR UPDATE', { id });
    for (const f of owned) await dissolveInTx(conn, f.id);
    const [u] = await conn.execute('SELECT username FROM users WHERE id = :id FOR UPDATE', { id });
    const [imgs] = await conn.execute('SELECT image_file FROM receipts WHERE user_id = :id AND image_file IS NOT NULL', { id });
    const [cnt] = await conn.execute('SELECT COUNT(*) AS n FROM receipts WHERE user_id = :id', { id });
    const [result] = await conn.execute('DELETE FROM users WHERE id = :id', { id });
    if (audit && result.affectedRows) {
      await insertAudit(conn, audit, {
        action: 'delete_user', target_type: 'user', target_id: id, target_label: u[0].username,
        detail: `连带删除 ${cnt[0].n} 张小票${owned.length ? `，解散其创建的 ${owned.length} 个家庭` : ''}`,
      });
    }
    await conn.commit();
    return { deleted: result.affectedRows, images: imgs.map((r) => r.image_file) };
  } catch (e) {
    try { await conn.rollback(); } catch (_) { /* 没有进行中的事务 */ }
    throw e;
  } finally {
    conn.release();
  }
}

async function deleteUser(id) {
  return (await deleteUserFull(id)).deleted;
}

// 用户自助注销。返回 { status, images }: status = 'ok' | 'not_found' | 'is_admin'(管理员不能自助注销) |
// 'creator'(是某个家庭的创建者: 须先转让或解散，不替用户做这个决定)。
// 加锁顺序与家庭管理一致: 先家庭行、再用户行；等锁期间所属家庭变了就重来。
async function deleteOwnAccount(userId) {
  await ready;
  const conn = await pool.getConnection();
  try {
    for (let attempt = 0; ; attempt++) {
      const [pre] = await conn.execute('SELECT family_id FROM users WHERE id = :userId', { userId });
      if (!pre[0]) return { status: 'not_found', images: [] };
      const guess = pre[0].family_id || null;
      await conn.beginTransaction();
      let fam = null;
      if (guess) fam = await lockFamily(conn, guess);
      const [u] = await conn.execute('SELECT family_id, is_admin FROM users WHERE id = :userId FOR UPDATE', { userId });
      if (!u[0]) { await conn.rollback(); return { status: 'not_found', images: [] }; }
      if ((u[0].family_id || null) !== guess) {
        await conn.rollback();
        if (attempt >= 4) throw new Error('家庭关系持续变化，请稍后重试');
        continue;
      }
      if (u[0].is_admin) { await conn.rollback(); return { status: 'is_admin', images: [] }; }
      if (fam && fam.creator_id === userId) { await conn.rollback(); return { status: 'creator', images: [] }; }
      const [imgs] = await conn.execute('SELECT image_file FROM receipts WHERE user_id = :userId AND image_file IS NOT NULL', { userId });
      await conn.execute('DELETE FROM users WHERE id = :userId', { userId });
      await conn.commit();
      return { status: 'ok', images: imgs.map((r) => r.image_file) };
    }
  } catch (e) {
    try { await conn.rollback(); } catch (_) { /* 没有进行中的事务 */ }
    throw e;
  } finally {
    conn.release();
  }
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

const api = {
  pool, saveReceipt, listReceipts, getReceipt, deleteReceipt, updateReceipt, findDuplicateReceipts,
  statsByCategory, statsBySubcategory, statsMonthly, priceTrend,
  distinctItemNames, overview,
  createUser, findUserByUsername, findUserById, countUsers, backfillOwnerlessReceipts,
  updatePassword, getSessionUser, findImageOwner,
  createInviteCode, listInviteCodes, revokeInviteCode, peekInviteCode, registerWithInvite,
  reserveScan, finishScan, setScanTier,
  migrateUsersInviteColumns, migrateUsersPasswordFlag, migrateUsersFamilyJoinedAt, // 导出仅供测试(升级路径)
  countRecentLoginFailures, isLoginLocked, recordLoginFailure, deleteLoginAttempt, clearLoginFailures,
  isPasswordLocked, recordPasswordFailure, countPasswordFailures, deletePasswordFailure, clearPasswordFailures,
  consumeCaptcha, reserveOpenSignup, listUsers, deleteUser, deleteUserFull, deleteOwnAccount, resetUserPassword, adminDeleteReceipt, listAuditLog, statsByUser,
  findFamilyByName, findFamilyById, createFamily, inviteMember, applyToFamily,
  listFamilyMembers, listPendingRequests, decideRequest,
  leaveFamily, removeMember, transferCreator, dissolveFamily, renameFamily, withdrawApplication, listMyApplications,
  addFeedback, listFeedbackByUser, listAllFeedback,
};

// 死锁重试: InnoDB 遇到死锁会自动回滚其中一方的事务(ER_LOCK_DEADLOCK)，这时整个函数从头再来一次是安全的——
// 下面这些函数都是"每次调用自己开事务/自己是单条语句"，失败的那次没有留下任何改动。
// 加锁顺序已经尽量统一(先家庭行、后用户/小票)，但管理员操作与并发请求之间仍可能偶发死锁，
// 此前会直接返回 500；现在最多重试 3 次再放弃。
const DEADLOCK_RETRY = [
  'saveReceipt', 'updateReceipt', 'adminDeleteReceipt', 'deleteUser', 'deleteUserFull', 'deleteOwnAccount',
  'resetUserPassword', 'setScanTier', 'registerWithInvite', 'createInviteCode', 'createFamily', 'inviteMember',
  'decideRequest', 'leaveFamily', 'removeMember', 'transferCreator', 'dissolveFamily', 'renameFamily',
  'recordPasswordFailure', 'recordLoginFailure', 'deleteLoginAttempt', 'clearLoginFailures',
];
function withDeadlockRetry(fn) {
  return async function retrying(...args) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn(...args);
      } catch (e) {
        if (!e || e.code !== 'ER_LOCK_DEADLOCK' || attempt >= 3) throw e;
        await new Promise((r) => setTimeout(r, 15 + Math.random() * 35));
      }
    }
  };
}
for (const name of DEADLOCK_RETRY) {
  if (typeof api[name] !== 'function') throw new Error('DEADLOCK_RETRY 里的函数不存在: ' + name);
  api[name] = withDeadlockRetry(api[name]);
}

module.exports = api;
