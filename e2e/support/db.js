// 建/删 E2E 专用库(只有 *_e2e_test 会被操作)
import mysql from 'mysql2/promise';

async function connect() {
  return mysql.createConnection({
    host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
  });
}

function guard(db) {
  if (!/_e2e_test$/.test(db || '')) throw new Error(`拒绝操作库 "${db}": 只允许 *_e2e_test`);
  return db;
}

export async function recreateDatabase() {
  const db = guard(process.env.MYSQL_DATABASE);
  const c = await connect();
  await c.query(`DROP DATABASE IF EXISTS \`${db}\``);
  await c.query(`CREATE DATABASE \`${db}\` DEFAULT CHARSET utf8mb4`);
  await c.end();
}

export async function dropDatabase() {
  const db = guard(process.env.MYSQL_DATABASE);
  const c = await connect();
  await c.query(`DROP DATABASE IF EXISTS \`${db}\``);
  await c.end();
}
