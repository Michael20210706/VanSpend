// 数据分析空状态、Chart.js 警告、小票详情布局、编辑器宽度、删除提示。
import zlib from 'zlib';
import { test, expect } from '@playwright/test';
import { makeUser, loginApi, makeReceipt, horizontalOverflow } from './support/helpers.js';

const goTab = (page, name) => page.locator('.tab', { hasText: name }).click();
const receiptRow = (page, store) => page.locator('tbody tr', { hasText: store });

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function solidPng(w, h) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h, 0x80);
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function saveReceiptWithImage(page, store) {
  const image = 'data:image/png;base64,' + solidPng(200, 300).toString('base64');
  const r = await page.request.post('/api/receipts', {
    data: {
      receipt: { store, purchased_at: '2026-05-01', currency: 'CAD', subtotal: 10, gst: 0, pst: 0, total: 10 },
      items: [{ name_raw: 'X', name_norm: 'x', category: '其他', subcategory: null, qty: 1, unit: null, unit_price: 10, amount: 10, taxable: 0 }],
      image,
    },
  });
  expect(r.status()).toBe(200);
}

async function emptyRange(page) {
  const dates = page.locator('input[type=date]:visible');
  await dates.nth(0).fill('2000-01-01');
  await dates.nth(1).fill('2000-01-31');
  await page.getByRole('button', { name: '应用', exact: true }).click();
}

const chartWarnings = (page) => {
  const list = [];
  page.on('console', (m) => { if (['warning', 'error'].includes(m.type())) list.push(m.text()); });
  return list;
};

test.describe('数据分析页', () => {
  test('空区间: 显示"暂无数据"，KPI 不出现 $-', async ({ page }) => {
    const user = await makeUser();
    await makeReceipt(user, { store: '空区间-' + Date.now() });
    await loginApi(page, user);
    await page.goto('/');
    await goTab(page, '数据分析');
    await expect(page.locator('.kpi', { hasText: '小票数' }).locator('.v')).toHaveText('1');
    await expect(page.getByText('暂无数据')).toBeHidden();

    await emptyRange(page);
    await expect(page.getByText('暂无数据：所选时间范围内没有小票')).toBeVisible();
    await expect(page.locator('.kpi', { hasText: '实付总额' }).locator('.v')).toHaveText('$0.00');
    await expect(page.locator('.kpi .v', { hasText: '$-' })).toHaveCount(0);
  });

  test('控制台没有 Chart.js 警告(有数据、价格趋势折线、空区间)', async ({ page }) => {
    const user = await makeUser();
    await makeReceipt(user, { store: '图表-' + Date.now() });
    await loginApi(page, user);
    const logs = chartWarnings(page);
    await page.goto('/');
    await goTab(page, '数据分析');
    await expect(page.locator('.kpi', { hasText: '小票数' }).locator('.v')).toHaveText('1');
    await page.getByPlaceholder('输入品名').fill('x');
    await page.getByRole('button', { name: '查询' }).click();
    await expect(page.locator('td', { hasText: '2026-05-01' })).toBeVisible();
    await emptyRange(page);
    await expect(page.locator('.kpi', { hasText: '小票数' }).locator('.v')).toHaveText('0');
    expect(logs.filter((l) => /fill|filler|chart/i.test(l))).toEqual([]);
  });
});

test.describe('小票详情与编辑器', () => {
  test('详情: 明细表不被右侧原图挤到图片下方', async ({ page }) => {
    const store = 'E2E-详情-' + Date.now();
    const user = await makeUser();
    await loginApi(page, user);
    await saveReceiptWithImage(page, store);
    await page.goto('/');
    await goTab(page, '小票记录');
    await receiptRow(page, store).getByRole('button', { name: '明细' }).click();
    const img = page.locator('img.receipt-image');
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((e) => e.complete && e.naturalWidth > 0)).toBe(true);
    const table = page.locator('.receipt-body .table-scroll, .card:has(img.receipt-image) .table-scroll').first();
    const ib = await img.boundingBox();
    const tb = await table.boundingBox();
    expect(ib.height).toBeGreaterThan(100);
    expect(tb.y, '表格顶部应在图片底部之上').toBeLessThan(ib.y + ib.height - 50);
    expect(tb.x + tb.width, '表格在图片左侧').toBeLessThanOrEqual(ib.x + 1);
  });

  test('编辑器: 分类下拉不窄于 110px；375px 下页面不横向滚动', async ({ page }) => {
    const store = 'E2E-编辑宽度-' + Date.now();
    const user = await makeUser();
    await makeReceipt(user, { store });
    await loginApi(page, user);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/');
    await goTab(page, '小票记录');
    await receiptRow(page, store).getByRole('button', { name: '明细' }).click();
    await page.getByRole('button', { name: '编辑' }).click();
    const editor = page.locator('.card', { has: page.getByRole('heading', { name: '编辑小票' }) });
    await expect(editor).toBeVisible();
    expect(await horizontalOverflow(page), '页面横向滚动').toBeLessThanOrEqual(0);
    const box = await editor.boundingBox();
    expect(box.width).toBeLessThanOrEqual(375);
    const sel = await editor.locator('tbody select').first().boundingBox();
    expect(sel.width).toBeGreaterThanOrEqual(110);
  });

  test('删除自己的小票: 先确认，成功后出现提示', async ({ page }) => {
    const store = 'E2E-删除提示-' + Date.now();
    const user = await makeUser();
    await makeReceipt(user, { store });
    await loginApi(page, user);
    await page.goto('/');
    await goTab(page, '小票记录');
    page.once('dialog', (d) => d.dismiss());
    await receiptRow(page, store).getByRole('button', { name: '删' }).click();
    await expect(receiptRow(page, store)).toHaveCount(1);
    await expect(page.getByText('已删除')).toBeHidden();

    page.once('dialog', (d) => d.accept());
    await receiptRow(page, store).getByRole('button', { name: '删' }).click();
    await expect(page.getByText('已删除 ✓')).toBeVisible();
    await expect(receiptRow(page, store)).toHaveCount(0);
  });
});
