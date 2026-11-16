import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const DB = path.resolve('src/db.cjs');
const CHILD = `require(${JSON.stringify(DB)}); setTimeout(() => process.exit(0), 1500);`;

// cwd 设到临时目录，db.cjs 的 .env 加载器读不到仓库里的 .env；端口 9 上没有 MySQL，连接会立即被拒。
function importDb(extraEnv) {
  return new Promise((resolve) => {
    const { NEXT_PHASE, ...base } = process.env;
    const env = { ...base, MYSQL_HOST: '127.0.0.1', MYSQL_PORT: '9', MYSQL_DATABASE: 'vanspend_buildphase_test', ...extraEnv };
    const child = spawn(process.execPath, ['-e', CHILD], { cwd: os.tmpdir(), env });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    child.on('close', () => resolve(output));
  });
}

describe('db.cjs 在 next build 期间不碰数据库', () => {
  it('构建期(NEXT_PHASE=phase-production-build)导入时不尝试建表或连库', async () => {
    const out = await importDb({ NEXT_PHASE: 'phase-production-build' });
    expect(out).not.toContain('[db]');
  });

  it('运行期导入时照常尝试建表(连不上就告警)', async () => {
    const out = await importDb({});
    expect(out).toContain('[db] 自动建表失败');
  });
});
