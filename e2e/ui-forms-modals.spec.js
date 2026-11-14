// 弹窗(Esc/聚焦/还焦点)、空提交提示、扫描提示在保存后消失。/api/scan 被拦截，不会调用 OpenRouter。
import { test, expect } from '@playwright/test';
import { makeUser, loginApi, dbApi, TINY_PNG } from './support/helpers.js';

const MODALS = [
  { link: '修改密码', heading: '修改密码', firstField: '当前密码' },
  { link: '邀请', heading: '邀请朋友' },
  { link: '意见反馈', heading: '意见反馈', firstField: '发现了 bug' },
  { link: '注销账号', heading: '注销账号', firstField: '输入当前密码确认' },
];

async function loggedIn(page) {
  const user = await makeUser();
  await loginApi(page, user);
  await page.goto('/');
  await expect(page.getByRole('link', { name: '退出' })).toBeVisible();
  return user;
}

function watchRequests(page, pathPart) {
  const seen = [];
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes(pathPart)) seen.push(r.url()); });
  return seen;
}

test.describe('弹窗 Esc 与焦点', () => {
  for (const m of MODALS) {
    test(`${m.heading}: Esc 关闭，焦点回到打开它的链接`, async ({ page }) => {
      await loggedIn(page);
      const opener = page.getByRole('link', { name: m.link, exact: true });
      await opener.focus();
      await opener.click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByRole('dialog').getByRole('heading', { name: m.heading })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(opener).toBeFocused();
    });

    if (m.firstField) {
      test(`${m.heading}: 打开时焦点在第一个输入框`, async ({ page }) => {
        await loggedIn(page);
        await page.getByRole('link', { name: m.link, exact: true }).click();
        await expect(page.getByRole('dialog').getByPlaceholder(m.firstField)).toBeFocused();
      });
    }
  }

  test('点遮罩关闭仍然可用', async ({ page }) => {
    await loggedIn(page);
    await page.getByRole('link', { name: '意见反馈', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('强制改密码弹窗: 焦点在输入框，Esc 不会关闭', async ({ page }) => {
    const user = await makeUser();
    await dbApi.pool.execute('UPDATE users SET must_change_password = 1 WHERE id = :id', { id: user.id });
    await loginApi(page, user);
    await page.goto('/');
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: '请先修改密码' })).toBeVisible();
    await expect(dialog.getByPlaceholder('临时密码')).toBeFocused();
    await page.keyboard.press('Escape');
    // 等一个确定的后续状态而不是 sleep: 再按一次键后弹窗仍在
    await dialog.getByPlaceholder('新密码', { exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: '请先修改密码' })).toBeVisible();
  });
});

test.describe('空提交提示', () => {
  test('注销账号: 密码为空显示提示且不发请求', async ({ page }) => {
    await loggedIn(page);
    const seen = watchRequests(page, '/api/auth/delete-account');
    await page.getByRole('link', { name: '注销账号', exact: true }).click();
    await page.getByRole('button', { name: '永久注销' }).click();
    await expect(page.getByRole('dialog').getByText('请输入密码确认')).toBeVisible();
    expect(seen).toHaveLength(0);
  });

  test('意见反馈: 内容为空(只有空格)显示提示且不发请求', async ({ page }) => {
    await loggedIn(page);
    const seen = watchRequests(page, '/api/feedback');
    await page.getByRole('link', { name: '意见反馈', exact: true }).click();
    await page.getByPlaceholder('发现了 bug').fill('   ');
    await page.getByRole('button', { name: '提交', exact: true }).click();
    await expect(page.getByRole('dialog').getByText('请输入反馈内容')).toBeVisible();
    expect(seen).toHaveLength(0);
  });

  test('创建家庭: 名称为空显示提示且不发请求；输入后提示消失并可创建', async ({ page }) => {
    await loggedIn(page);
    const seen = watchRequests(page, '/api/family');
    await page.locator('.tab', { hasText: '家庭' }).click();
    await page.getByRole('button', { name: '创建', exact: true }).click();
    await expect(page.getByText('请输入家庭名称')).toBeVisible();
    expect(seen).toHaveLength(0);
    const name = 'E2E空名' + Date.now();
    await page.getByPlaceholder('家庭名称', { exact: true }).fill(name);
    await expect(page.getByText('请输入家庭名称')).toHaveCount(0);
    await page.getByRole('button', { name: '创建', exact: true }).click();
    await expect(page.getByRole('heading', { name })).toBeVisible();
  });

  test('申请加入家庭: 名称为空显示提示且不发请求', async ({ page }) => {
    await loggedIn(page);
    const seen = watchRequests(page, '/api/family/apply');
    await page.locator('.tab', { hasText: '家庭' }).click();
    await page.getByRole('button', { name: '申请加入' }).click();
    await expect(page.getByText('请输入要加入的家庭名称')).toBeVisible();
    expect(seen).toHaveLength(0);
  });
});

test.describe('扫描提示', () => {
  test('保存后「识别完成，请核对」消失', async ({ page }) => {
    await loggedIn(page);
    const payload = {
      receipt: { store: 'E2E-提示-' + Date.now(), purchased_at: '2026-05-01', currency: 'CAD', subtotal: 5, gst: 0, pst: 0, total: 5 },
      items: [{ name_raw: 'X', name_norm: 'x', category: '其他', subcategory: null, qty: 1, unit: null, unit_price: 5, amount: 5, taxable: 0 }],
      raw: { mocked: true },
    };
    await page.route('**/api/scan', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) }));
    await page.locator('input[type=file]').setInputFiles({ name: 'r.png', mimeType: 'image/png', buffer: TINY_PNG });
    await page.getByRole('button', { name: 'AI 识别' }).click();
    await expect(page.getByText('识别完成，请核对')).toBeVisible();
    await page.getByRole('button', { name: '保存到账本' }).click();
    await expect(page.getByText('已保存 ✓')).toBeVisible();
    await expect(page.getByText('识别完成，请核对')).toHaveCount(0);
  });
});
