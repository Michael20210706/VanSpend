// (a) 登录/退出 (#34) 与 (b) 注册表单 (#33) + 邀请码注册
import { test, expect } from '@playwright/test';
import { dbApi, makeUser, makeInviteCode, PASSWORD, horizontalOverflow } from './support/helpers.js';
import crypto from 'crypto';

test.describe('登录与退出', () => {
  test('输入用户名密码后按回车登录，进入应用 (#34)', async ({ page }) => {
    const user = await makeUser();
    await page.goto('/login');
    await page.getByPlaceholder('用户名').fill(user.username);
    await page.getByPlaceholder('密码').fill(PASSWORD());
    await page.getByPlaceholder('密码').press('Enter'); // 回车提交依赖登录区域是真正的 <form>
    await expect(page.getByRole('link', { name: '退出' })).toBeVisible();
    await expect(page).toHaveURL('/');
    await expect(page.locator('header')).toContainText(user.username);
  });

  test('点登录按钮同样能登录', async ({ page }) => {
    const user = await makeUser();
    await page.goto('/login');
    await page.getByPlaceholder('用户名').fill(user.username);
    await page.getByPlaceholder('密码').fill(PASSWORD());
    await page.getByRole('button', { name: '登录' }).click();
    await expect(page.getByRole('link', { name: '退出' })).toBeVisible();
  });

  test('密码错误: 显示错误并停留在登录页，不进入应用', async ({ page }) => {
    const user = await makeUser();
    await page.goto('/login');
    await page.getByPlaceholder('用户名').fill(user.username);
    await page.getByPlaceholder('密码').fill(PASSWORD() + '-wrong');
    await page.getByPlaceholder('密码').press('Enter');
    await expect(page.getByText('用户名或密码错误')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('link', { name: '退出' })).toHaveCount(0);
  });

  test('什么都不填直接提交: 提示输入，不发请求', async ({ page }) => {
    await page.goto('/login');
    let posted = false;
    page.on('request', (r) => { if (r.url().includes('/api/auth/login')) posted = true; });
    await page.getByRole('button', { name: '登录' }).click();
    await expect(page.getByText('请输入用户名和密码')).toBeVisible();
    expect(posted).toBe(false);
  });

  test('退出登录: 回到未登录首页，会话失效 (#34)', async ({ page }) => {
    const user = await makeUser();
    await page.goto('/login');
    await page.getByPlaceholder('用户名').fill(user.username);
    await page.getByPlaceholder('密码').fill(PASSWORD());
    await page.getByPlaceholder('密码').press('Enter');
    await page.getByRole('link', { name: '退出' }).click();
    await expect(page.getByRole('link', { name: '登录' }).first()).toBeVisible(); // 落地页导航
    await expect(page.getByRole('link', { name: '退出' })).toHaveCount(0);
    expect((await page.request.get('/api/auth/me')).status()).toBe(401);
  });
});

test.describe('注册表单', () => {
  test('375px 宽: 验证码答案输入框不被挤成一条缝，页面不横向滚动 (#33)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/login?mode=register');
    await expect(page.getByRole('img', { name: /验证码/ })).toBeVisible();
    const box = await page.getByPlaceholder('计算结果').boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(100);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  test('桌面宽度下验证码输入框同样够宽', async ({ page }) => {
    await page.goto('/login?mode=register');
    await expect(page.getByRole('img', { name: /验证码/ })).toBeVisible();
    expect((await page.getByPlaceholder('计算结果').boundingBox()).width).toBeGreaterThanOrEqual(100);
  });

  test('autocomplete: 登录是 current-password，注册是 new-password (#34)', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByPlaceholder('用户名')).toHaveAttribute('autocomplete', 'username');
    await expect(page.getByPlaceholder('密码')).toHaveAttribute('autocomplete', 'current-password');
    await page.goto('/login?mode=register');
    await expect(page.getByPlaceholder('用户名')).toHaveAttribute('autocomplete', 'username');
    await expect(page.getByPlaceholder('密码')).toHaveAttribute('autocomplete', 'new-password');
  });

  test('用邀请码注册: 不需要验证码，建号并直接登录', async ({ page }) => {
    const inviter = await makeUser();
    const code = await makeInviteCode(inviter);
    const username = 'reg_' + crypto.randomBytes(4).toString('hex');
    await page.goto('/login?mode=register&code=' + encodeURIComponent(code));
    await expect(page.getByPlaceholder('邀请码(可选)')).toHaveValue(code); // 链接里的 code 预填
    await expect(page.getByPlaceholder('计算结果')).toHaveCount(0); // 有邀请码就不出验证码
    await page.getByPlaceholder('用户名').fill(username);
    await page.getByPlaceholder('密码').fill(PASSWORD());
    await page.getByRole('button', { name: '注册' }).click();
    await expect(page.getByRole('link', { name: '退出' })).toBeVisible();
    await expect(page.locator('header')).toContainText(username);
    const row = await dbApi.findUserByUsername(username);
    expect(row.signup_source).toBe('invite');
    expect(row.invited_by).toBe(inviter.id);
  });

  test('无效邀请码: 提示错误，不建号', async ({ page }) => {
    const username = 'reg_' + crypto.randomBytes(4).toString('hex');
    await page.goto('/login?mode=register&code=not-a-real-code');
    await page.getByPlaceholder('用户名').fill(username);
    await page.getByPlaceholder('密码').fill(PASSWORD());
    await page.getByRole('button', { name: '注册' }).click();
    await expect(page.getByText('邀请码无效、已被使用或已过期')).toBeVisible();
    await expect(page.getByRole('link', { name: '退出' })).toHaveCount(0);
    expect(await dbApi.findUserByUsername(username)).toBeFalsy();
  });

  test('邀请码只能用一次', async ({ page }) => {
    const inviter = await makeUser();
    const code = await makeInviteCode(inviter);
    const first = 'reg_' + crypto.randomBytes(4).toString('hex');
    const r = await page.request.post('/api/auth/register', { data: { username: first, password: PASSWORD(), inviteCode: code } });
    expect(r.status()).toBe(200);
    await page.context().clearCookies();
    const second = 'reg_' + crypto.randomBytes(4).toString('hex');
    await page.goto('/login?mode=register&code=' + encodeURIComponent(code));
    await page.getByPlaceholder('用户名').fill(second);
    await page.getByPlaceholder('密码').fill(PASSWORD());
    await page.getByRole('button', { name: '注册' }).click();
    await expect(page.getByText('邀请码无效、已被使用或已过期')).toBeVisible();
  });
});
