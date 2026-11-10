import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(process.cwd()) } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    globalSetup: ['tests/globalSetup.js'],
    setupFiles: ['tests/setup.js'],
    // 所有测试文件共用一个测试库，串行跑，避免互相踩数据
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
