// H-I 事件记录: 模拟扫描 -> 改字段 -> 保存 -> save_events 里有 1 行，只含字段名(不含值)。
// /api/scan 用 page.route 拦截，不调用 OpenRouter。拦截后服务端不会写 scan_log，所以前两个用例先直接种一行 scan_log，
// 把它的 id 放进模拟响应的 scanId(验证保存事件能对应到自己的扫描)；第三个用例的响应不带 scanId(验证没有也照样记)。
import { test, expect } from '@playwright/test';
import { makeUser, loginApi, dbApi, TINY_PNG } from './support/helpers.js';

function scanPayload({ store, scanId } = {}) {
  const items = [
    { name_raw: 'BEEF STEAK', name_norm: '牛排', category: '肉类', subcategory: '牛肉', qty: 1, unit: 'kg', unit_price: 15, amount: 15, taxable: 0 },
    { name_raw: 'DISH SOAP', name_norm: '洗洁精', category: '日用清洁', subcategory: null, qty: 1, unit: null, unit_price: 5, amount: 5, taxable: 1 },
  ];
  const receipt = { store, purchased_at: '2026-05-01', currency: 'CAD', subtotal: 20, gst: 0.25, pst: 1.25, total: 21.5 };
  return { receipt, items, raw: { mocked: true }, ...(scanId ? { scanId } : {}) };
}

async function scanAndReview(page, payload) {
  await page.route('**/api/scan', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) }));
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({ name: 'r.png', mimeType: 'image/png', buffer: TINY_PNG });
  await page.getByRole('button', { name: 'AI 识别' }).click();
  await expect(page.getByText('识别完成，请核对')).toBeVisible();
  return page.locator('.card', { has: page.getByRole('heading', { name: '2 · 核对并保存' }) });
}

const eventsOf = async (user) => (await dbApi.pool.query('SELECT * FROM save_events WHERE user_id = ? ORDER BY id', [user.id]))[0];
const fields = (row) => JSON.parse(row.edited_fields);

test.describe('保存事件', () => {
  test('改商家、改第一行金额、删第二行、加一行 → 1 行事件，字段名齐全，条数正确，指向这次扫描', async ({ page }) => {
    const store = 'E2E-事件-' + Date.now();
    const user = await makeUser();
    const slot = await dbApi.reserveScan(user.id, 'e2e-mock', null); // 模拟"这次扫描"的 scan_log 行
    await loginApi(page, user);
    const review = await scanAndReview(page, scanPayload({ store, scanId: slot.id }));

    await review.getByLabel('商家').fill(store + '-改');
    const rows = review.locator('tbody tr');
    await rows.nth(0).locator('input[type=number]').nth(2).fill('16'); // 金额
    await rows.nth(1).getByRole('button', { name: '×' }).click();
    await expect(rows).toHaveCount(1);
    await review.getByRole('button', { name: '+ 添加一行' }).click();
    await expect(rows).toHaveCount(2);
    await rows.nth(1).locator('input').first().fill('新加的');

    await review.getByRole('button', { name: '保存到账本' }).click();
    await expect(page.getByText('已保存 ✓')).toBeVisible();

    const ev = await eventsOf(user);
    expect(ev).toHaveLength(1);
    expect(fields(ev[0]).sort()).toEqual(['item[+]', 'item[-]', 'item[0].amount', 'receipt.store'].sort());
    expect(ev[0]).toMatchObject({ scan_log_id: slot.id, items_ai: 2, items_saved: 2 });
    expect(ev[0].receipt_id).not.toBeNull();
    expect(ev[0].scan_to_save_ms).toBeGreaterThanOrEqual(0);
    const dump = JSON.stringify(ev[0]);
    expect(dump).not.toContain(store);
    expect(dump).not.toContain('新加的');
    expect(dump).not.toContain('BEEF');
  });

  test('什么都没改就保存 → edited_fields 为空数组', async ({ page }) => {
    const user = await makeUser();
    const slot = await dbApi.reserveScan(user.id, 'e2e-mock', null);
    await loginApi(page, user);
    const review = await scanAndReview(page, scanPayload({ store: 'E2E-未改-' + Date.now(), scanId: slot.id }));
    await review.getByRole('button', { name: '保存到账本' }).click();
    await expect(page.getByText('已保存 ✓')).toBeVisible();
    const ev = await eventsOf(user);
    expect(ev).toHaveLength(1);
    expect(fields(ev[0])).toEqual([]);
    expect(ev[0]).toMatchObject({ scan_log_id: slot.id, items_ai: 2, items_saved: 2 });
  });

  test('扫描响应里没有 scanId(没有可对应的扫描记录)→ 仍写 1 行，scan_log_id 为 NULL', async ({ page }) => {
    const user = await makeUser();
    await loginApi(page, user);
    const review = await scanAndReview(page, scanPayload({ store: 'E2E-无扫描-' + Date.now() }));
    await review.getByLabel('GST').fill('0.5');
    await review.getByRole('button', { name: '保存到账本' }).click();
    await expect(page.getByText('已保存 ✓')).toBeVisible();
    const ev = await eventsOf(user);
    expect(ev).toHaveLength(1);
    expect(ev[0].scan_log_id).toBeNull();
    expect(fields(ev[0])).toEqual(['receipt.gst']);
    expect(ev[0].items_ai).toBe(2);
  });
});
