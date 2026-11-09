// 每个测试文件运行前: 加载测试环境变量、把上传目录指到临时目录、用内存 cookie 罐替换 next/headers。
import fs from 'fs';
import os from 'os';
import path from 'path';
import { vi } from 'vitest';
import { loadTestEnv } from './env.js';
import { jar } from './cookieJar.js';

loadTestEnv();
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vanspend-test-uploads-'));

vi.mock('next/headers', () => ({ cookies: async () => jar }));
