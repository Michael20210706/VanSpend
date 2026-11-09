// 加载 .env.test(+ 可选的 .env.test.local)到 process.env，覆盖已有值；
// globalSetup 和每个测试文件的 setup 都会调用，保证两处看到同一份配置。
import fs from 'fs';
import path from 'path';

function loadFile(file) {
  const p = path.join(process.cwd(), file);
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

export function loadTestEnv() {
  loadFile('.env.test');
  loadFile('.env.test.local');
  const db = process.env.MYSQL_DATABASE || '';
  if (!/_test$/.test(db)) {
    throw new Error(`拒绝运行测试: MYSQL_DATABASE="${db}" 不以 _test 结尾(防止连到生产库)`);
  }
}
