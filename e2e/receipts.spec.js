// (c) 扫描 -> 保存 -> 列表/看板 -> 重复提示 -> 明细 -> 编辑 -> 删除。/api/scan 被拦截，返回与真实路由同形状的 { receipt, items, raw }，不会调用 OpenRouter。
import { test, expect } from '@playwright/test';
import { makeUser, loginApi, makeReceipt, TINY_PNG } from './support/helpers.js';

function scanPayload({ store, total = 21.5 } = {}) {
  const items = [
    { name_raw: 'BEEF STEAK', name_norm: '牛排', category: '肉类', subcategory: '牛肉', qty: 1, unit: 'kg', unit_price: 15, amount: 15, taxable: 0 },
    { name_raw: 'DISH SOAP', name_norm: '洗洁精', category: '日用清洁', subcategory: null, qty: 1, unit: null, unit_price: 5, amount: 5, taxable: 1 },
  ];
  const receipt = { store, purchased_at: '2026-05-01', currency: 'CAD', subtotal: 20, gst: 0.25, pst: 1.25, total };
  return { receipt, items, raw: { mocked: true } };
}

async function mockScan(page, payload) {
  let calls = 0;
  await page.route('**/api/scan', async (route) => {
    calls += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  });
  return () => calls;
}

async function scanAndReview(page) {
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({ name: 'r.png', mimeType: 'image/png', buffer: TINY_PNG });
  await expect(page.locator('#preview')).toBeVisible();
  await page.getByRole('button', { name: 'AI 识别' }).click();
  await expect(page.getByText('识别完成，请核对')).toBeVisible();
  return page.locator('.card', { has: page.getByRole('heading', { name: '2 · 核对并保存' }) });
}

const goTab = (page, name) => page.locator('.tab', { hasText: name }).click();
const receiptRow = (page, store) => page.locator('tbody tr', { hasText: store });

test.describe('扫描与保存', () => {
  test('扫描(mock) -> 改一行 -> 保存 -> 出现在小票列表和看板 KPI', async ({ page }) => {
    const store = 'E2E-超市-' + Date.now();
    const user = await makeUser();
    await loginApi(page, user);
    const scanCalls = await mockScan(page, scanPayload({ store }));
    const review = await scanAndReview(page);
    expect(scanCalls()).toBe(1);

    await expect(review.getByLabel('商家')).toHaveValue(store);
    // 改第一行的品名
    const firstRow = review.locator('tbody tr').first();
    await firstRow.locator('input').first().fill('改过的牛排');
    await expect(review.locator('tbody tr')).toHaveCount(2);

    await review.getByRole('button', { name: '保存到账本' }).click();
    await expect(page.getByText('已保存 ✓')).toBeVisible();

    await goTab(page, '小票记录');
    const row = receiptRow(page, store);
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('21.50');
    await expect(row).toContainText('2026-05-01');
    await row.getByRole('button', { name: '明细' }).click();
    await expect(page.getByRole('heading', { name: new RegExp(store) })).toBeVisible();
    await expect(page.getByText('改过的牛排')).toBeVisible(); // 保存的是编辑后的明细

    await goTab(page, '数据分析');
    await expect(page.locator('.kpi', { hasText: '小票数' }).locator('.v')).toHaveText('1');
    await expect(page.locator('.kpi', { hasText: '实付总额' }).locator('.v')).toHaveText('$21.50');
    await expect(page.locator('.kpi', { hasText: '商品条目' }).locator('.v')).toHaveText('2');
  });

  test('未选图片时 AI 识别按钮不可用，不会调用扫描接口', async ({ page }) => {
    const user = await makeUser();
    await loginApi(page, user);
    const scanCalls = await mockScan(page, scanPayload({ store: 'X' }));
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'AI 识别' })).toBeDisabled();
    expect(scanCalls()).toBe(0);
  });

  test('扫描接口失败: 提示识别失败，不出现核对表格', async ({ page }) => {
    const user = await makeUser();
    await loginApi(page, user);
    await page.route('**/api/scan', (route) =>
      route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: '识别服务暂时不可用，请稍后重试' }) }));
    await page.goto('/');
    await page.locator('input[type=file]').setInputFiles({ name: 'r.png', mimeType: 'image/png', buffer: TINY_PNG });
    await page.getByRole('button', { name: 'AI 识别' }).click();
    await expect(page.getByText('识别失败: 识别服务暂时不可用')).toBeVisible();
    await expect(page.getByRole('heading', { name: '2 · 核对并保存' })).toBeHidden();
  });

  test('同商家+同日期+同总额再存一次: 弹出重复提示；取消则不保存，确认才保存', async ({ page }) => {
    const store = 'E2E-重复-' + Date.now();
    const user = await makeUser();
    await makeReceipt(user, { store, total: 21.5 }); // 日期 2026-05-01，与 mock 一致
    await loginApi(page, user);
    await mockScan(page, scanPayload({ store, total: 21.5 }));
    const review = await scanAndReview(page);

    let message = '';
    page.once('dialog', (d) => { message = d.message(); d.dismiss(); });
    await review.getByRole('button', { name: '保存到账本' }).click();
    await expect.poll(() => message).toContain('可能重复');
    await goTab(page, '小票记录');
    await expect(receiptRow(page, store)).toHaveCount(1); // 取消 = 没有第二张

    await goTab(page, '上传识别');
    page.once('dialog', (d) => d.accept());
    await review.getByRole('button', { name: '保存到账本' }).click();
    await expect(page.getByText('已保存 ✓')).toBeVisible();
    await goTab(page, '小票记录');
    await expect(receiptRow(page, store)).toHaveCount(2); // 只是提示，确认后照存
  });

  test('不重复的小票保存时不弹提示', async ({ page }) => {
    const store = 'E2E-不重复-' + Date.now();
    const user = await makeUser();
    await makeReceipt(user, { store, total: 99 }); // 同商家同日期，但总额不同
    await loginApi(page, user);
    await mockScan(page, scanPayload({ store, total: 21.5 }));
    const review = await scanAndReview(page);
    let dialogs = 0;
    page.on('dialog', (d) => { dialogs += 1; d.dismiss(); });
    await review.getByRole('button', { name: '保存到账本' }).click();
    await expect(page.getByText('已保存 ✓')).toBeVisible();
    expect(dialogs).toBe(0);
  });
});

test.describe('明细、编辑、删除', () => {
  test('编辑自己的小票: 改金额和 GST 后，实付按明细重算', async ({ page }) => {
    const store = 'E2E-编辑-' + Date.now();
    const user = await makeUser();
    await makeReceipt(user, { store, total: 10 });
    await loginApi(page, user);
    await page.goto('/');
    await goTab(page, '小票记录');
    await receiptRow(page, store).getByRole('button', { name: '明细' }).click();
    await page.getByRole('button', { name: '编辑' }).click();

    const editor = page.locator('.card', { has: page.getByRole('heading', { name: '编辑小票' }) });
    await editor.locator('tbody tr').first().locator('input[type=number]').nth(2).fill('25.5'); // 金额(数量/单价/金额 中的第 3 个数字框)
    await editor.getByLabel('GST').fill('1');
    await expect(editor).toContainText('实付 $26.50'); // 实时预览
    await editor.getByRole('button', { name: '保存修改' }).click();
    await expect(page.getByText('已保存修改 ✓')).toBeVisible();
    await expect(page.locator('.muted', { hasText: '实付' })).toContainText('税前 $25.50');
    await expect(page.locator('.muted', { hasText: '实付' })).toContainText('实付 $26.50');
    await expect(receiptRow(page, store)).toContainText('26.50'); // 列表也已更新
  });

  test('编辑时把商家清空: 保存失败，原数据不变', async ({ page }) => {
    const store = 'E2E-编辑失败-' + Date.now();
    const user = await makeUser();
    await makeReceipt(user, { store, total: 10 });
    await loginApi(page, user);
    await page.goto('/');
    await goTab(page, '小票记录');
    await receiptRow(page, store).getByRole('button', { name: '明细' }).click();
    await page.getByRole('button', { name: '编辑' }).click();
    const editor = page.locator('.card', { has: page.getByRole('heading', { name: '编辑小票' }) });
    await editor.getByLabel('商家').fill('');
    await editor.getByRole('button', { name: '保存修改' }).click();
    await expect(page.getByText(/保存失败/)).toBeVisible();
    await editor.getByRole('button', { name: '取消' }).click();
    await expect(receiptRow(page, store)).toHaveCount(1);
  });

  test('删除自己的小票: 取消确认则保留，确认后消失', async ({ page }) => {
    const store = 'E2E-删除-' + Date.now();
    const user = await makeUser();
    await makeReceipt(user, { store, total: 10 });
    await loginApi(page, user);
    await page.goto('/');
    await goTab(page, '小票记录');
    const row = receiptRow(page, store);

    page.once('dialog', (d) => d.dismiss());
    await row.getByRole('button', { name: '删' }).click();
    await expect(row).toHaveCount(1);

    page.once('dialog', (d) => d.accept());
    await row.getByRole('button', { name: '删' }).click();
    await expect(row).toHaveCount(0);
    await expect(page.getByText('暂无记录')).toBeVisible();
  });
});
