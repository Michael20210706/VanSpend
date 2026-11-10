// 整个测试运行开始前: 删掉并重建测试库，让 src/db.cjs 的 initSchema() 从零建表。
import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import { loadTestEnv } from './env.js';

// .env 里的连接信息(用户名/密码)只补齐 .env.test 没写的键，与 src/db.cjs 的加载规则一致
function fillFromDotEnv() {
  const p = path.join(process.cwd(), '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

export default async function setup() {
  loadTestEnv();
  fillFromDotEnv();
  const db = process.env.MYSQL_DATABASE;
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
  });
  await conn.query(`DROP DATABASE IF EXISTS \`${db}\``);
  await conn.query(`CREATE DATABASE \`${db}\` DEFAULT CHARSET utf8mb4`);
  await conn.end();
}
