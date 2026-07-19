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
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS receipts (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       INT UNSIGNED,                       -- 归属用户；旧数据迁移时回填给首个注册账号
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
  CONSTRAINT fk_receipts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS items (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  receipt_id    INT UNSIGNED  NOT NULL,
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
  CONSTRAINT fk_items_receipt FOREIGN KEY (receipt_id) REFERENCES receipts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
