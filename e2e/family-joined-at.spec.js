// issue #36: 家庭成员表的"加入时间"是加入家庭的时间(不是注册时间)；界面上的数据库时间按查看者本地时区显示成 YYYY-MM-DD HH:mm
import { test, expect } from '@playwright/test';
import { makeUser, adminUser, loginApi, dbApi } from './support/helpers.js';
import { BASE_URL } from './support/env.js';

// 固定偏移 UTC-8(无夏令时): 不同来源的时区数据库(Node 的 ICU、Chrome、系统)对温哥华的夏令时规则可能不一致，断言不该依赖它
const TZ = 'Etc/GMT+8';

// 数据库里的 UTC 字符串 → 指定时区的 YYYY-MM-DD HH:mm(用 Intl 独立算一遍，不复用应用里的实现)
function expectedLocal(dbString, timeZone = TZ) {
  const d = new Date(dbString.replace(' ', 'T') + 'Z');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

const row = async (sql, params) => (await dbApi.pool.query(sql, params))[0][0];

async function vancouverPage(browser, user) {
  const context = await browser.newContext({ baseURL: BASE_URL, timezoneId: TZ, locale: 'zh-CN' });
  const page = await context.newPage();
  await loginApi(page, user);
  await page.goto('/');
  await expect(page.getByRole('link', { name: '退出' })).toBeVisible();
  return page;
}

test('成员表"加入时间"是入家庭的时间，不是注册时间；按本地时区显示，悬停显示 UTC 原值', async ({ browser }) => {
  const creator = await makeUser({ prefix: 'jc' });
  const member = await makeUser({ prefix: 'jm' });
  const legacy = await makeUser({ prefix: 'jl' });
  await dbApi.pool.execute('UPDATE users SET created_at = NOW() - INTERVAL 400 DAY WHERE id IN (?, ?)', [member.id, legacy.id]);
  const familyId = await dbApi.createFamily('E2E加入' + Date.now(), creator.id);
  expect(await dbApi.inviteMember(familyId, member.username)).toBe(true);
  // 模拟升级前就在家庭里的老成员: 有 family_id、没有加入时间
  await dbApi.pool.execute("UPDATE users SET family_id = ?, account_type = 'family' WHERE id = ?", [familyId, legacy.id]);

  const page = await vancouverPage(browser, creator);
  await page.locator('.tab', { hasText: '家庭' }).click();
  const memberRow = page.locator('tbody tr', { hasText: member.username });
  await expect(memberRow).toBeVisible();

  const db = await row('SELECT created_at, family_joined_at FROM users WHERE id = ?', [member.id]);
  expect(db.family_joined_at).not.toBe(db.created_at);
  const cell = memberRow.locator('td').nth(2);
  const shown = (await cell.textContent()).trim();
  expect(shown).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  expect(shown).toBe(expectedLocal(db.family_joined_at));
  expect(shown).not.toBe(expectedLocal(db.created_at));
  await expect(cell).toHaveAttribute('title', `${db.family_joined_at} UTC`);

  await expect(page.locator('tbody tr', { hasText: legacy.username }).locator('td').nth(2)).toHaveText('—');
  await page.context().close();
});

test('管理员用户表的注册时间同样按本地时区显示', async ({ browser }) => {
  const u = await makeUser({ prefix: 'jt' });
  await dbApi.pool.execute("UPDATE users SET created_at = '2026-01-15 03:30:00' WHERE id = ?", [u.id]);
  const page = await vancouverPage(browser, adminUser());
  await page.goto('/admin');
  await page.locator('.tab', { hasText: '用户管理' }).click();
  const r = page.locator('tbody tr:visible', { hasText: u.username });
  await expect(r).toBeVisible();
  // 03:30 UTC 在 UTC-8 是前一天 19:30
  await expect(r).toContainText('2026-01-14 19:30');
  await expect(r.locator('td[title="2026-01-15 03:30:00 UTC"]')).toHaveCount(1);
  await page.context().close();
});
