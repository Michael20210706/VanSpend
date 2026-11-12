// (f) /admin 在 375/768/1440 宽度下任何一个 tab 都不横向溢出，即使用户过滤下拉里有 90 字符的用户名 (#32)；非管理员看到"无权限"
import { test, expect } from '@playwright/test';
import crypto from 'crypto';
import { makeUser, adminUser, loginApi, makeReceipt, horizontalOverflow } from './support/helpers.js';

const TABS = [
  { name: '统计', heading: /各分类花费占比/ },
  { name: '用户管理', heading: '用户管理' },
  { name: '票据管理', heading: /票据管理/ },
  { name: '用户反馈', heading: '用户反馈' },
  { name: '操作日志', heading: '操作日志' },
];

for (const width of [375, 768, 1440]) {
  test(`管理后台 ${width}px: 每个 tab 都不横向溢出，含 90 字符用户名 (#32)`, async ({ page }) => {
    const longName = 'long' + crypto.randomBytes(4).toString('hex') + 'x'.repeat(78); // 4+8+78 = 90
    expect(longName).toHaveLength(90);
    const longUser = await makeUser({ username: longName });
    await makeReceipt(longUser, { store: 'E2E-长名字' });
    await page.setViewportSize({ width, height: 900 });
    await loginApi(page, adminUser());
    await page.goto('/admin');
    for (const tab of TABS) {
      await page.locator('.tab', { hasText: tab.name }).click();
      await expect(page.getByRole('heading', { name: tab.heading }).first()).toBeVisible();
      if (tab.name === '票据管理') {
        await expect(page.locator('select option', { hasText: longName })).toHaveCount(1); // 长用户名确实在下拉里
      }
      expect(await horizontalOverflow(page), `tab ${tab.name} @${width}px`).toBeLessThanOrEqual(0);
    }
  });
}

test.describe('管理后台权限', () => {
  test('普通用户访问 /admin: 只看到无权限卡片，管理接口 403', async ({ page }) => {
    const user = await makeUser();
    await loginApi(page, user);
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: '无权限' })).toBeVisible();
    await expect(page.locator('.tab')).toHaveCount(0);
    expect((await page.request.get('/api/admin/users')).status()).toBe(403);
  });

  test('未登录访问 /admin: 无权限卡片，管理接口 401', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: '无权限' })).toBeVisible();
    expect((await page.request.get('/api/admin/users')).status()).toBe(401);
  });

  test('管理员访问 /admin: 能看到用户管理，退出后回到首页', async ({ page }) => {
    await loginApi(page, adminUser());
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: '无权限' })).toHaveCount(0);
    await page.locator('.tab', { hasText: '用户管理' }).click();
    await expect(page.getByRole('heading', { name: '用户管理' })).toBeVisible();
    await page.getByRole('link', { name: '退出' }).click();
    await expect(page).toHaveURL('/');
  });
});
