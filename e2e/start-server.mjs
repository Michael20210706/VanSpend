// Playwright webServer 的启动命令。Playwright 先启动 webServer、后跑 globalSetup，所以"重建库 + 建表 + 种管理员"必须在这里做，
// 否则应用起来时库还不存在。顺序: 重建 vanspend_e2e_test -> 让 src/db.cjs 建表并按 ADMIN_* 种管理员 -> 启动生产构建 next start。
import { spawn } from 'child_process';
import fs from 'fs';
import { createRequire } from 'module';
import { applyE2eEnv, E2E_PORT } from './support/env.js';
import { recreateDatabase } from './support/db.js';

applyE2eEnv();
if (!fs.existsSync('.next/BUILD_ID')) {
  console.error('[e2e] 找不到 .next 构建产物，请先 npm run build(npm run test:e2e 会自动构建)');
  process.exit(1);
}
await recreateDatabase();

const dbApi = createRequire(import.meta.url)('../src/db.cjs');
await dbApi.countUsers(); // 等 initSchema + seedAdmin 完成
await dbApi.pool.end();

const child = spawn('node_modules/.bin/next', ['start', '-p', String(E2E_PORT), '-H', '127.0.0.1'], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'production' },
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code) => process.exit(code ?? 0));
