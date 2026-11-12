-- VanSpend MySQL schema
-- 手动初始化用: mysql -h $MYSQL_HOST -u $MYSQL_USER -p < schema.sql
-- (应用启动时也会自动执行等价的 CREATE TABLE IF NOT EXISTS，这份文件供 DBA 预先建库建表、
--  或在只授予 SELECT/INSERT/UPDATE/DELETE 权限、不允许应用自动建表的环境下使用)

CREATE DATABASE IF NOT EXISTS vanspend CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE vanspend;

CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(100)  NOT NULL UNIQUE,
  password_hash VARCHAR(255)  NOT NULL,
  is_admin      TINYINT(1)    NOT NULL DEFAULT 0,   -- 管理后台权限；只能通过 ADMIN_USERNAME/ADMIN_PASSWORD 启动时初始化
  family_id     INT UNSIGNED,                       -- 所属家庭；NULL = 个人账号或尚未加入家庭
  family_role   ENUM('dad','mom','child','other'),  -- 家庭角色标签，个人/家庭账号都可选填
  family_joined_at TIMESTAMP NULL DEFAULT NULL,     -- 加入当前家庭的时间(UTC)；离开/被移除/解散清空；升级前的老成员为 NULL
  account_type  ENUM('individual','family') NOT NULL DEFAULT 'individual',
  signup_source ENUM('invite','open') NOT NULL DEFAULT 'invite',  -- 注册来源；老账号一律按 invite 处理
  scan_tier     ENUM('open','normal') NOT NULL DEFAULT 'normal',  -- 每日扫描额度档位(见 config.json scanQuota)；开放注册的新账号是 open，管理员可升级
  invited_by    INT UNSIGNED,                                      -- 邀请人；邀请人账号被删后置空
  must_change_password TINYINT(1) NOT NULL DEFAULT 0,               -- 管理员重置密码后为 1: 用户改掉临时密码之前，除改密码/退出外的接口一律 403
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_users_family (family_id),
  INDEX idx_users_invited_by (invited_by),
  CONSTRAINT fk_users_invited_by FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 已登录用户"输密码确认"(修改密码、注销账号)的错误尝试记录，按 user_id；用户输入够不着这张表(不像 login_failures 存的是登录框里的任意字符串)
CREATE TABLE IF NOT EXISTS pw_failures (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       INT UNSIGNED  NOT NULL,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pwf_user_time (user_id, created_at),
  CONSTRAINT fk_pwf_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 已用过的验证码 token(其 SHA-256)：同一个 token 只能用一次；过期行在每次写入时顺手清掉
CREATE TABLE IF NOT EXISTS captcha_used (
  token_key     CHAR(64)      NOT NULL PRIMARY KEY,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_captcha_used_time (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 开放注册(过了验证码)的尝试记录，按 IP 限速用(滚动 24 小时上限见 src/db.cjs)；没有外键，只存 IP
CREATE TABLE IF NOT EXISTS signup_attempts (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ip            VARCHAR(64)   NOT NULL,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_signup_ip_time (ip, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 管理员写操作日志(只增不改，没有修改/删除它的接口；不记录查看)。操作人/对象存文字快照，对象或操作人被删后日志仍可读
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  admin_id       INT UNSIGNED,
  admin_username VARCHAR(100)  NOT NULL,
  action         VARCHAR(40)   NOT NULL,                            -- delete_user / delete_receipt / reset_password / set_tier
  target_type    ENUM('user','receipt') NOT NULL,
  target_id      INT UNSIGNED  NOT NULL,
  target_label   VARCHAR(255)  NOT NULL,
  detail         VARCHAR(255),
  created_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_created (created_at),
  CONSTRAINT fk_audit_admin FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS families (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(100)  NOT NULL UNIQUE,      -- 家庭名称，系统内唯一
  creator_id    INT UNSIGNED  NOT NULL,              -- 创建者：唯一有权邀请成员/审核申请的人
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_families_creator FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- users.family_id 依赖 families 表，建表顺序上只能事后补 FK(families 建表时又依赖 users.id 已存在)
ALTER TABLE users ADD CONSTRAINT fk_users_family FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS family_join_requests (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  family_id     INT UNSIGNED  NOT NULL,
  user_id       INT UNSIGNED  NOT NULL,             -- 申请加入的用户
  status        ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at    TIMESTAMP     NULL,                 -- 创建者审核(通过/拒绝)的时间
  INDEX idx_fjr_family_status (family_id, status),
  CONSTRAINT fk_fjr_family FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE,
  CONSTRAINT fk_fjr_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS receipts (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       INT UNSIGNED,                       -- 归属用户；旧数据迁移时回填给首个注册账号
  family_id     INT UNSIGNED,                       -- 冗余: 建票时从 users 拷贝，供家庭内可见性/统计直接按列过滤，避免每次 JOIN users
  family_name   VARCHAR(100),
  family_role   ENUM('dad','mom','child','other'),
  account_type  ENUM('individual','family') NOT NULL DEFAULT 'individual',
  store         VARCHAR(255)  NOT NULL DEFAULT '未知',
  purchased_at  DATE          NOT NULL,
  currency      VARCHAR(10)   NOT NULL DEFAULT 'CAD',
  subtotal      DECIMAL(10,2) NOT NULL DEFAULT 0,   -- 税前合计
  gst           DECIMAL(10,2) NOT NULL DEFAULT 0,
  pst           DECIMAL(10,2) NOT NULL DEFAULT 0,
  total         DECIMAL(10,2) NOT NULL DEFAULT 0,   -- 实付总额
  image_file    VARCHAR(255),
  raw_json      LONGTEXT,                           -- 模型原始返回，便于复核/纠错
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_receipts_date (purchased_at),
  INDEX idx_receipts_user (user_id),
  INDEX idx_receipts_family (family_id),
  INDEX idx_receipts_image (image_file),
  CONSTRAINT fk_receipts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_receipts_family FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS items (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  receipt_id    INT UNSIGNED  NOT NULL,
  family_id     INT UNSIGNED,                       -- 冗余: 同 receipts，跟随建票时的用户家庭信息一起落地
  family_name   VARCHAR(100),
  family_role   ENUM('dad','mom','child','other'),
  account_type  ENUM('individual','family') NOT NULL DEFAULT 'individual',
  name_raw      VARCHAR(255)  NOT NULL,             -- 小票原文(可能是缩写/中文)
  name_norm     VARCHAR(255),                       -- 规范化品名，用于跨时间比价
  category      VARCHAR(100)  NOT NULL DEFAULT '其他',
  subcategory   VARCHAR(100),                       -- 细分: 牛肉/猪肉/鸡肉/三文鱼...
  qty           DECIMAL(10,3) NOT NULL DEFAULT 1,
  unit          VARCHAR(50),                        -- 单位: 个/kg/lb/包
  unit_price    DECIMAL(10,4),                      -- 单价(原币)
  amount        DECIMAL(10,2) NOT NULL DEFAULT 0,   -- 该行小计(税前)
  taxable       TINYINT(1)    NOT NULL DEFAULT 0,   -- 是否计税 0/1
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_items_receipt  (receipt_id),
  INDEX idx_items_category (category),
  INDEX idx_items_subcat   (subcategory),
  INDEX idx_items_norm     (name_norm),
  INDEX idx_items_family   (family_id),
  CONSTRAINT fk_items_receipt FOREIGN KEY (receipt_id) REFERENCES receipts(id) ON DELETE CASCADE,
  CONSTRAINT fk_items_family FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS feedback (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       INT UNSIGNED  NOT NULL,
  content       TEXT          NOT NULL,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_feedback_user (user_id),
  CONSTRAINT fk_feedback_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 登录失败记录(防爆破)。只记失败；username 存用户输入的原文(可能根本不存在)，所以不挂外键
CREATE TABLE IF NOT EXISTS login_failures (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(100)  NOT NULL,
  ip            VARCHAR(64)   NOT NULL,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_lf_user_time (username, created_at),
  INDEX idx_lf_ip_time   (ip, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 邀请码: 单次有效。family_id 非空 = 入家庭邀请码(注册后直接加入该家庭)。
-- 码本身是 128 位随机数(base64url)，不可猜；状态(未用/已用/作废/过期)由 used_by/revoked_at/expires_at 推出
CREATE TABLE IF NOT EXISTS invite_codes (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 每次调用 OpenRouter 的记录(成功与否都记)，同时是每日扫描额度的计数依据。success NULL = 进行中
CREATE TABLE IF NOT EXISTS scan_log (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       INT UNSIGNED  NOT NULL,
  model         VARCHAR(100),
  success       TINYINT(1),
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_scan_user_time (user_id, created_at),
  CONSTRAINT fk_scan_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
