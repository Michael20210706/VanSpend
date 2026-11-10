// 每个测试文件运行前: 加载测试环境变量、把上传目录指到临时目录、用内存 cookie 罐替换 next/headers。
import fs from 'fs';
import os from 'os';
import path from 'path';
import { vi, beforeEach } from 'vitest';
import { loadTestEnv } from './env.js';
import { jar } from './cookieJar.js';

loadTestEnv();
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vanspend-test-uploads-'));

vi.mock('next/headers', () => ({ cookies: async () => jar }));

// 全站总量限制(开放注册总名额、开放档识别总预算)是跨用户的全局计数，所有测试共用一个库，
// 不清的话前面的测试会把后面测试的名额/预算吃光。每个测试开始前清掉这两张表(测试自己需要的数据在测试里现造)。
beforeEach(async () => {
  const db = (await import('@/src/db.cjs')).default;
  await db.countUsers(); // 等建表/迁移跑完(各函数内部都会 await ready，直接用 pool 不会)
  await db.pool.query('DELETE FROM signup_attempts');
  await db.pool.query('DELETE FROM scan_log');
});
