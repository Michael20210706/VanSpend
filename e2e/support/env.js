// E2E 的环境变量: 由 playwright.config.js(主进程)调用一次。Playwright 的 worker 由主进程 fork，继承同一份 process.env，
// 所以随机密码/SESSION_SECRET 每次运行只生成一次，worker 里再调用这个函数不会重新生成(已有值不覆盖)。
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

export const E2E_PORT = Number(process.env.E2E_PORT || 3401); // 多个检出并行跑 E2E 时各自指定端口
// 一律用 127.0.0.1: 应用会拒绝 Origin 主机和 Host 不一致的写请求，localhost 与 127.0.0.1 混用会被当成跨站
export const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

function loadFile(file) {
  const p = path.join(process.cwd(), file);
  if (!fs.existsSync(p)) return {};
  const out = {};
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

export function applyE2eEnv() {
  const env = process.env;
  // MySQL 账号: 进程环境(CI)优先，否则取 .env.test.local(与 tests/env.js 同一个约定)；绝不读 .env 里的生产库名
  const local = loadFile('.env.test.local');
  for (const k of ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_USER', 'MYSQL_PASSWORD']) {
    if (!env[k] && local[k]) env[k] = local[k];
  }
  if (!env.MYSQL_HOST) env.MYSQL_HOST = '127.0.0.1';
  // 库名: 只接受 *_e2e_test(CI 里 step 的 env 会设成 vanspend_e2e_test)，其余一律回到默认，且必须以 _test 结尾
  if (!/_e2e_test$/.test(env.MYSQL_DATABASE || '')) env.MYSQL_DATABASE = 'vanspend_e2e_test';
  if (!/_test$/.test(env.MYSQL_DATABASE)) throw new Error('E2E 拒绝运行: MYSQL_DATABASE 必须以 _test 结尾');

  const rand = (n) => crypto.randomBytes(n).toString('hex');
  if (!env.E2E_PASSWORD) env.E2E_PASSWORD = 'Pw-' + rand(12); // 所有测试账号共用一个每次运行随机生成的密码，不写进任何文件
  if (!env.SESSION_SECRET || env.E2E_RUN !== '1') env.SESSION_SECRET = rand(24);
  env.E2E_RUN = '1';
  env.ADMIN_USERNAME = 'e2e_admin';
  env.ADMIN_PASSWORD = env.E2E_PASSWORD;
  env.COOKIE_SECURE = 'false';
  env.OPENROUTER_API_KEY = 'sk-or-e2e-invalid'; // 扫描接口在测试里被拦截，绝不能真的出网
  env.PORT = String(E2E_PORT);
  if (!env.UPLOAD_DIR) env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vanspend-e2e-uploads-'));
  return env;
}
