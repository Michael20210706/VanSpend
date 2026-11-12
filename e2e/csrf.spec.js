// (g) 写请求的来源校验: 外站 Origin 一律 403，同源 Origin 放行
import { test, expect } from '@playwright/test';
import { makeUser, loginApi } from './support/helpers.js';
import { BASE_URL } from './support/env.js';

test.describe('写请求的 Origin 校验', () => {
  test('带外站 Origin 的写请求: 403，且没有产生副作用', async ({ page }) => {
    const user = await makeUser();
    await loginApi(page, user); // 带着有效会话 cookie，模拟"别的网站借用户浏览器发请求"
    const r = await page.request.post('/api/feedback', {
      data: { content: 'from-evil-site' },
      headers: { origin: 'http://evil.example' },
    });
    expect(r.status()).toBe(403);
    const mine = await (await page.request.get('/api/feedback')).json();
    expect(mine.map((f) => f.content)).not.toContain('from-evil-site');
  });

  test('Origin 主机相同但端口不同: 也是 403', async ({ page }) => {
    const user = await makeUser();
    await loginApi(page, user);
    const r = await page.request.post('/api/feedback', { data: { content: 'other-port' }, headers: { origin: 'http://127.0.0.1:3999' } });
    expect(r.status()).toBe(403);
  });

  test('Origin: null (沙箱 iframe / 重定向链) 与浏览器声明的 cross-site: 403', async ({ page }) => {
    const user = await makeUser();
    await loginApi(page, user);
    expect((await page.request.post('/api/feedback', { data: { content: 'x' }, headers: { origin: 'null' } })).status()).toBe(403);
    expect((await page.request.post('/api/feedback', { data: { content: 'x' }, headers: { 'sec-fetch-site': 'cross-site' } })).status()).toBe(403);
  });

  test('正确的同源 Origin: 放行并真的写入', async ({ page }) => {
    const user = await makeUser();
    await loginApi(page, user);
    const r = await page.request.post('/api/feedback', { data: { content: 'same-origin-ok' }, headers: { origin: BASE_URL } });
    expect(r.status()).toBe(200);
    const mine = await (await page.request.get('/api/feedback')).json();
    expect(mine.map((f) => f.content)).toContain('same-origin-ok');
  });

  test('不带 Origin 的非浏览器客户端: 放行；登录接口对外站 Origin 同样 403', async ({ page }) => {
    const user = await makeUser();
    await loginApi(page, user);
    expect((await page.request.post('/api/feedback', { data: { content: 'no-origin' } })).status()).toBe(200);
    const login = await page.request.post('/api/auth/login', {
      data: { username: user.username, password: process.env.E2E_PASSWORD }, headers: { origin: 'http://evil.example' },
    });
    expect(login.status()).toBe(403);
  });

  test('浏览器里真实发出的写请求带同源 Origin，能成功 (不被误杀)', async ({ page }) => {
    const user = await makeUser();
    await loginApi(page, user);
    await page.goto('/');
    await page.getByRole('link', { name: '意见反馈' }).click();
    await expect(page.getByRole('heading', { name: '意见反馈' })).toBeVisible();
    await page.getByPlaceholder('发现了 bug').fill('typed-in-browser');
    await page.getByRole('button', { name: '提交', exact: true }).click();
    await expect.poll(async () => (await (await page.request.get('/api/feedback')).json()).map((f) => f.content)).toContain('typed-in-browser');
  });
});
