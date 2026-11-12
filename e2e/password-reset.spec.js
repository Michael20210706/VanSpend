// (e) 管理员重置密码时，用户已打开的页面: 下一步操作就弹出强制改密码界面(无需刷新、无未处理的 promise rejection) (#30)，
// 界面里的"退出登录"可点击(#31)，改完密码应用恢复可用
import { test, expect } from '@playwright/test';
import { makeUser, adminUser, apiContextFor, loginApi, trackErrors, PASSWORD } from './support/helpers.js';
import crypto from 'crypto';
import { BASE_URL } from './support/env.js';

async function openAppThenAdminResets(page) {
  const user = await makeUser({ prefix: 'reset' });
  await loginApi(page, user);
  const tracker = await trackErrors(page);
  await page.goto('/');
  await expect(page.getByRole('link', { name: '退出' })).toBeVisible();
  await page.evaluate(() => { window.__sameDocument = true; });

  const admin = await apiContextFor(adminUser());
  const r = await admin.post(`/api/admin/users/${user.id}/reset-password`);
  expect(r.status()).toBe(200);
  const { temporaryPassword } = await r.json();
  await admin.dispose();
  return { user, temporaryPassword, tracker };
}

const goTab = (page, name) => page.locator('.tab', { hasText: name }).click();

test.describe('管理员重置密码后，用户页面已经打开着', () => {
  test('下一次操作直接出现强制改密码界面: 不刷新页面，没有未处理的 rejection (#30)', async ({ page }) => {
    const { tracker } = await openAppThenAdminResets(page);
    await goTab(page, '小票记录'); // 触发一次被 403 password_change_required 拒绝的请求
    await expect(page.getByRole('heading', { name: '请先修改密码' })).toBeVisible();
    await expect(page.getByPlaceholder('临时密码')).toBeVisible();
    expect(await page.evaluate(() => window.__sameDocument === true)).toBe(true); // 没有整页刷新
    await expect(page.locator('.tab')).toHaveCount(0); // 应用本身不再渲染
    expect(await tracker.rejections()).toEqual([]);
    expect(tracker.errors).toEqual([]);
  });

  test('强制改密码界面里的退出登录链接没有被遮罩盖住，点得到 (#31)', async ({ page }) => {
    await openAppThenAdminResets(page);
    await goTab(page, '小票记录');
    const logout = page.getByRole('link', { name: '退出登录' });
    await expect(logout).toBeVisible();
    await logout.click({ timeout: 5000 }); // Playwright 会检查点击点上命中的就是这个元素，被遮罩盖住会一直重试到超时
    await expect(page.getByRole('link', { name: '登录' }).first()).toBeVisible();
    expect((await page.request.get('/api/auth/me')).status()).toBe(401);
  });

  test('用临时密码设置新密码后: 应用恢复可用，旧临时密码失效，新密码能登录', async ({ page }) => {
    const { user, temporaryPassword } = await openAppThenAdminResets(page);
    await goTab(page, '小票记录');
    const newPassword = 'N-' + crypto.randomBytes(8).toString('hex');
    await page.getByPlaceholder('临时密码').fill(temporaryPassword);
    await page.getByPlaceholder('新密码', { exact: true }).fill(newPassword);
    await page.getByPlaceholder('确认新密码').fill(newPassword);
    await page.getByRole('button', { name: '确定' }).click();
    await expect(page.getByRole('heading', { name: '请先修改密码' })).toBeHidden();
    await goTab(page, '小票记录');
    await expect(page.getByRole('heading', { name: '小票记录' })).toBeVisible();
    await expect(page.getByText('暂无记录')).toBeVisible(); // 接口不再 403，列表能加载

    const fresh = await page.context().browser().newContext();
    const login = (pw) => fresh.request.post(BASE_URL + '/api/auth/login', { data: { username: user.username, password: pw } });
    expect((await login(temporaryPassword)).status()).toBe(401);
    expect((await login(newPassword)).status()).toBe(200);
    await fresh.close();
  });

  test('临时密码填错: 提示当前密码不正确，仍停在强制改密码界面', async ({ page }) => {
    await openAppThenAdminResets(page);
    await goTab(page, '小票记录');
    await page.getByPlaceholder('临时密码').fill('not-the-temporary-password');
    await page.getByPlaceholder('新密码', { exact: true }).fill('Another-1');
    await page.getByPlaceholder('确认新密码').fill('Another-1');
    await page.getByRole('button', { name: '确定' }).click();
    await expect(page.getByText('当前密码不正确')).toBeVisible();
    await expect(page.getByRole('heading', { name: '请先修改密码' })).toBeVisible();
  });

  test('新密码与临时密码相同: 被拒绝', async ({ page }) => {
    const { temporaryPassword } = await openAppThenAdminResets(page);
    await goTab(page, '小票记录');
    await page.getByPlaceholder('临时密码').fill(temporaryPassword);
    await page.getByPlaceholder('新密码', { exact: true }).fill(temporaryPassword);
    await page.getByPlaceholder('确认新密码').fill(temporaryPassword);
    await page.getByRole('button', { name: '确定' }).click();
    await expect(page.getByText('新密码不能和当前密码相同')).toBeVisible();
  });

  test('对照: 没被重置的用户，同样的操作不会出现强制改密码界面', async ({ page }) => {
    const user = await makeUser();
    await loginApi(page, user);
    await page.goto('/');
    await goTab(page, '小票记录');
    await expect(page.getByText('暂无记录')).toBeVisible();
    await expect(page.getByRole('heading', { name: '请先修改密码' })).toHaveCount(0);
    expect(PASSWORD()).toBeTruthy();
  });
});
