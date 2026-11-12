// (d) 家庭里的读共享/写私有: 成员能看到别人的小票，但没有删除/编辑入口，直接调 API 删也是 404 (#35)
import { test, expect } from '@playwright/test';
import { makeUser, makeFamily, makeReceipt, loginApi } from './support/helpers.js';

const goTab = (page, name) => page.locator('.tab', { hasText: name }).click();

test.describe('家庭内的小票权限', () => {
  test('成员看得到别人的小票，但没有删除按钮，也没有编辑按钮 (#35)', async ({ page }) => {
    const owner = await makeUser({ prefix: 'owner' });
    const member = await makeUser({ prefix: 'member' });
    const familyId = await makeFamily(owner, member);
    const store = 'E2E-权限-' + Date.now();
    await makeReceipt(owner, { familyId, store });
    await loginApi(page, member);
    await page.goto('/');
    await goTab(page, '小票记录');
    const row = page.locator('tbody tr', { hasText: store });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(owner.username); // 所属成员列
    await expect(row.getByRole('button', { name: '明细' })).toBeVisible();
    await expect(row.getByRole('button', { name: '删' })).toHaveCount(0);
    await row.getByRole('button', { name: '明细' }).click();
    await expect(page.getByRole('heading', { name: new RegExp(store) })).toBeVisible();
    await expect(page.getByRole('button', { name: '编辑' })).toHaveCount(0);
  });

  test('成员直接调 DELETE/PUT: 404，小票还在 (#35)', async ({ page }) => {
    const owner = await makeUser({ prefix: 'owner' });
    const member = await makeUser({ prefix: 'member' });
    const familyId = await makeFamily(owner, member);
    const id = await makeReceipt(owner, { familyId, store: 'E2E-API权限' });
    await loginApi(page, member);
    expect((await page.request.delete('/api/receipts/' + id)).status()).toBe(404);
    const put = await page.request.put('/api/receipts/' + id, {
      data: { receipt: { store: 'x', purchased_at: '2026-05-01', gst: 0, pst: 0 }, items: [{ name_raw: 'a', category: '其他', qty: 1, amount: 1, taxable: 0 }] },
    });
    expect(put.status()).toBe(404);
    expect((await page.request.get('/api/receipts/' + id)).status()).toBe(200); // 读是共享的，且小票没被动过
    const detail = await (await page.request.get('/api/receipts/' + id)).json();
    expect(detail.store).toBe('E2E-API权限');
  });

  test('所有者本人: 有删除按钮和编辑按钮，API 删除成功', async ({ page }) => {
    const owner = await makeUser({ prefix: 'owner' });
    const member = await makeUser({ prefix: 'member' });
    const familyId = await makeFamily(owner, member);
    const store = 'E2E-所有者-' + Date.now();
    const id = await makeReceipt(owner, { familyId, store });
    await loginApi(page, owner);
    await page.goto('/');
    await goTab(page, '小票记录');
    const row = page.locator('tbody tr', { hasText: store });
    await expect(row.getByRole('button', { name: '删' })).toBeVisible();
    await row.getByRole('button', { name: '明细' }).click();
    await expect(page.getByRole('button', { name: '编辑' })).toBeVisible();
    expect((await page.request.delete('/api/receipts/' + id)).status()).toBe(200);
    expect((await page.request.delete('/api/receipts/' + id)).status()).toBe(404); // 删过的再删
  });

  test('非家庭成员: 看不到别人的小票，API 读取 404', async ({ page }) => {
    const owner = await makeUser({ prefix: 'owner' });
    const outsider = await makeUser({ prefix: 'outsider' });
    const familyId = await makeFamily(owner);
    const store = 'E2E-外人-' + Date.now();
    const id = await makeReceipt(owner, { familyId, store });
    await loginApi(page, outsider);
    await page.goto('/');
    await goTab(page, '小票记录');
    await expect(page.getByText('暂无记录')).toBeVisible();
    await expect(page.locator('tbody tr', { hasText: store })).toHaveCount(0);
    expect((await page.request.get('/api/receipts/' + id)).status()).toBe(404);
  });
});
