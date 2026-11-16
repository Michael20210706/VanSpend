// 识别阶段的核对提示: 日期未识别(date_guessed)与未识别差额行(residual_added)。/api/scan 被拦截，返回与真实路由同形状的
// { receipt, items, raw }，不会调用 OpenRouter。保存走真实接口，差额行按普通明细入库。
import { test, expect } from '@playwright/test';
import { makeUser, loginApi, TINY_PNG } from './support/helpers.js';

const DATE_HINT = '日期未识别，已填今天，请核对';
const RESIDUAL_HINT = '有一条未识别差额，请核对';
const RESIDUAL_NAME = '未识别差额(请核对)';
const GAP_HINT = /明细合计加税与实付相差/;
const today = () => new Date().toISOString().slice(0, 10);

function payload({ store, date = '2026-05-01', dateGuessed = false, residual = false }) {
  const items = [
    { name_raw: 'BEEF STEAK', name_norm: '牛排', category: '肉类', subcategory: '牛肉', qty: 1, unit: 'kg', unit_price: 15, amount: 15, taxable: 0 },
    { name_raw: 'DISH SOAP', name_norm: '洗洁精', category: '日用清洁', subcategory: null, qty: 1, unit: null, unit_price: 5, amount: 5, taxable: 1 },
  ];
  const receipt = { store, purchased_at: date, date_guessed: dateGuessed, residual_added: residual, currency: 'CAD', subtotal: 20, gst: 0.25, pst: 1.25, total: 21.5 };
  if (residual) {
    items.push({ name_raw: RESIDUAL_NAME, name_norm: null, category: '其他', subcategory: null, qty: 1, unit: null, unit_price: 9.5, amount: 9.5, taxable: 0 });
    receipt.subtotal = 29.5;
    receipt.total = 31;
  }
  return { receipt, items, raw: { mocked: true } };
}

async function scanWith(page, p) {
  await page.route('**/api/scan', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(p) }));
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({ name: 'r.png', mimeType: 'image/png', buffer: TINY_PNG });
  await page.getByRole('button', { name: 'AI 识别' }).click();
  await expect(page.getByText('识别完成，请核对')).toBeVisible();
  return page.locator('.card', { has: page.getByRole('heading', { name: '2 · 核对并保存' }) });
}

test.describe('日期未识别提示', () => {
  test('扫描返回 date_guessed: 日期框旁出现提示；用户改了日期后提示消失', async ({ page }) => {
    const user = await makeUser();
    await loginApi(page, user);
    const review = await scanWith(page, payload({ store: 'E2E-无日期-' + Date.now(), date: today(), dateGuessed: true }));
    await expect(review.getByText(DATE_HINT)).toBeVisible();
    await expect(review.getByLabel('日期')).toHaveValue(today());
    await review.getByLabel('日期').fill('2026-05-02');
    await expect(review.getByText(DATE_HINT)).toBeHidden();
  });

  test('扫描返回了日期: 没有提示', async ({ page }) => {
    const user = await makeUser();
    await loginApi(page, user);
    const review = await scanWith(page, payload({ store: 'E2E-有日期-' + Date.now() }));
    await expect(review.getByLabel('日期')).toHaveValue('2026-05-01');
    await expect(review.getByText(DATE_HINT)).toHaveCount(0);
    await expect(review.getByText(RESIDUAL_HINT)).toHaveCount(0);
  });
});

test.describe('未识别差额行', () => {
  test('扫描返回 residual_added: 差额行出现在明细表、表下有提示；保存后按普通明细入库', async ({ page }) => {
    const store = 'E2E-差额-' + Date.now();
    const user = await makeUser();
    await loginApi(page, user);
    const review = await scanWith(page, payload({ store, residual: true }));
    await expect(review.getByText(RESIDUAL_HINT)).toBeVisible();
    const rows = review.locator('tbody tr');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(2).locator('input').first()).toHaveValue(RESIDUAL_NAME);
    await expect(review.getByLabel('税前')).toHaveValue('29.5');

    await review.getByRole('button', { name: '保存到账本' }).click();
    await expect(page.getByText('已保存 ✓')).toBeVisible();

    const list = await (await page.request.get('/api/receipts')).json();
    const saved = list.find((r) => r.store === store);
    expect(saved).toBeTruthy();
    const detail = await (await page.request.get('/api/receipts/' + saved.id)).json();
    expect(detail).not.toHaveProperty('residual_added');
    expect(detail).not.toHaveProperty('date_guessed');
    expect(Number(detail.subtotal)).toBe(29.5);
    expect(Number(detail.total)).toBe(31);
    const residual = detail.items.find((i) => i.name_raw === RESIDUAL_NAME);
    expect(residual).toMatchObject({ category: '其他', taxable: 0 });
    expect(Number(residual.amount)).toBe(9.5);
  });

  test('删掉差额行后明细与实付对不上: 出现实时提示并写明相差多少；把这笔钱补回一行后提示消失', async ({ page }) => {
    const user = await makeUser();
    await loginApi(page, user);
    const review = await scanWith(page, payload({ store: 'E2E-差额删除-' + Date.now(), residual: true }));
    await expect(review.getByText(GAP_HINT)).toHaveCount(0); // 带差额行时明细合计 + 税 = 实付
    const rows = review.locator('tbody tr');
    await rows.nth(2).getByRole('button', { name: '×' }).click();
    await expect(rows).toHaveCount(2);
    await expect(review.getByText('明细合计加税与实付相差 9.50，请核对')).toBeVisible();
    await review.getByRole('button', { name: '+ 添加一行' }).click();
    await expect(rows).toHaveCount(3);
    await rows.nth(2).locator('input[type=number]').last().fill('9.5');
    await expect(review.getByText(GAP_HINT)).toHaveCount(0);
  });

  test('没有差额的小票: 不出现对不上的提示', async ({ page }) => {
    const user = await makeUser();
    await loginApi(page, user);
    const review = await scanWith(page, payload({ store: 'E2E-对得上-' + Date.now() }));
    await expect(review.locator('tbody tr')).toHaveCount(2);
    await expect(review.getByText(GAP_HINT)).toHaveCount(0);
  });
});

test.describe('税额超过 BC 上限', () => {
  const PST_HINT = /PST 超过明细合计的 10%/;
  test('小费被填进 PST: 出现提示；把 PST 改回合理值后提示消失', async ({ page }) => {
    const user = await makeUser();
    await loginApi(page, user);
    const p = payload({ store: 'E2E-税超上限-' + Date.now() });
    p.receipt.pst = 9.25; // 1.25 的税 + 8 元小费
    p.receipt.total = 29.5;
    const review = await scanWith(page, p);
    await expect(review.getByText(PST_HINT)).toBeVisible();
    await expect(review.getByText(GAP_HINT)).toHaveCount(0); // 明细合计加税仍等于实付，旧提示发现不了
    await review.getByLabel('PST').fill('1.25');
    await expect(review.getByText(PST_HINT)).toBeHidden();
  });

  test('正常税额: 不出现税额提示', async ({ page }) => {
    const user = await makeUser();
    await loginApi(page, user);
    const review = await scanWith(page, payload({ store: 'E2E-税正常-' + Date.now() }));
    await expect(review.locator('tbody tr')).toHaveCount(2);
    await expect(review.getByText(/超过明细合计的/)).toHaveCount(0);
  });
});
