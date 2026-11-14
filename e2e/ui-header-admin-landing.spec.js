// #37 页头/管理后台/落地页: html lang 跟随落地页语言、落地页不写死模型名、管理员自己的行没有删除按钮、
// 删除家庭创建者的确认文案、按用户筛选后的面板标题
import { test, expect } from '@playwright/test';
import { makeUser, makeFamily, adminUser, loginApi } from './support/helpers.js';

test.describe('落地页', () => {
  test('html lang 跟随落地页语言: 中文 zh-CN，切到英文 en，再切回', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.lp')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await page.locator('.lp-lang').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.locator('.lp-lang').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  });

  test('?lang=en 直接进入英文: html lang 为 en', async ({ page }) => {
    await page.goto('/?lang=en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('落地页(中英文)不写死模型名', async ({ page }) => {
    for (const lang of ['zh', 'en']) {
      await page.goto('/?lang=' + lang);
      await expect(page.locator('.lp')).toBeVisible();
      const text = await page.locator('.lp').innerText();
      expect(text, lang).not.toMatch(/gemini/i);
    }
  });
});

test.describe('管理后台用户列表', () => {
  test('自己的行没有删除按钮，别人的行有', async ({ page }) => {
    const other = await makeUser({ prefix: 'del' });
    await loginApi(page, adminUser());
    await page.goto('/admin');
    await page.locator('.tab', { hasText: '用户管理' }).click();
    const rows = page.locator('table:visible tbody tr');
    await expect(rows.filter({ hasText: other.username })).toHaveCount(1);
    await expect(rows.filter({ hasText: other.username }).getByRole('button', { name: '删除' })).toHaveCount(1);
    const mine = rows.filter({ hasText: adminUser().username });
    await expect(mine).toHaveCount(1);
    await expect(mine.getByRole('button', { name: '删除' })).toHaveCount(0);
  });

  test('删除确认: 家庭创建者的文案说明会解散家庭，普通用户没有这句', async ({ page }) => {
    const creator = await makeUser({ prefix: 'cr' });
    const member = await makeUser({ prefix: 'mb' });
    const plain = await makeUser({ prefix: 'pl' });
    await makeFamily(creator, member);
    await loginApi(page, adminUser());
    await page.goto('/admin');
    await page.locator('.tab', { hasText: '用户管理' }).click();
    const rows = page.locator('table:visible tbody tr');

    async function confirmText(user) {
      let message = null;
      page.once('dialog', (d) => { message = d.message(); d.dismiss(); });
      await rows.filter({ hasText: user.username }).getByRole('button', { name: '删除' }).click();
      await expect.poll(() => message).not.toBeNull();
      return message;
    }
    expect(await confirmText(creator)).toContain('解散');
    expect(await confirmText(member)).not.toContain('解散');
    expect(await confirmText(plain)).not.toContain('解散');
  });
});

test.describe('管理后台票据管理', () => {
  test('按用户筛选后标题显示该用户，清除后回到全部用户', async ({ page }) => {
    const u = await makeUser({ prefix: 'flt' });
    await loginApi(page, adminUser());
    await page.goto('/admin');
    await page.locator('.tab', { hasText: '票据管理' }).click();
    const heading = page.getByRole('heading', { name: /票据管理/ }).filter({ visible: true });
    await expect(heading).toHaveText('票据管理(全部用户)');
    const select = page.locator('select:visible').filter({ has: page.locator('option', { hasText: u.username }) });
    await expect(select.locator('option', { hasText: u.username })).toHaveCount(1);
    await select.selectOption({ label: u.username });
    await expect(heading).toHaveText(`票据管理(${u.username})`);
    await page.getByRole('button', { name: '清除' }).filter({ visible: true }).click();
    await expect(heading).toHaveText('票据管理(全部用户)');
  });
});
