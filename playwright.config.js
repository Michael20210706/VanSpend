// 端到端测试(Playwright + 系统 Chrome): 对一个全新的生产构建实例 + 独立库 vanspend_e2e_test 跑真实浏览器。
// 与 Vitest 互不相干: Vitest 只收 tests/**/*.test.js，这里只收 e2e/**/*.spec.js。
import { defineConfig } from '@playwright/test';
import { applyE2eEnv, BASE_URL } from './e2e/support/env.js';

applyE2eEnv();

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.js',
  globalTeardown: './e2e/global-teardown.js',
  workers: 1, // 共用一个库
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  globalTimeout: 10 * 60_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    channel: 'chrome', // 系统自带的 Google Chrome，不下载浏览器
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chrome', use: { viewport: { width: 1280, height: 800 } } }],
  webServer: {
    command: 'node e2e/start-server.mjs',
    url: BASE_URL + '/login',
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
