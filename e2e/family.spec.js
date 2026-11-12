// (h) 家庭流程: 创建、按用户名邀请、申请+审批(通过/拒绝)、退出。多个用户 = 多个独立的浏览器上下文
import { test, expect } from '@playwright/test';
import crypto from 'crypto';
import { makeUser, loginApi } from './support/helpers.js';

const goFamilyTab = (page) => page.locator('.tab', { hasText: '家庭' }).click();
const familyName = () => 'E2E家庭' + crypto.randomBytes(4).toString('hex');

async function userPage(browser, user) {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3401' });
  const page = await context.newPage();
  await loginApi(page, user);
  await page.goto('/');
  await expect(page.getByRole('link', { name: '退出' })).toBeVisible();
  return page;
}

async function createFamilyUi(page, name) {
  await goFamilyTab(page);
  await page.getByPlaceholder('家庭名称', { exact: true }).fill(name);
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByText('创建者', { exact: true })).toBeVisible();
}

test.describe('创建与邀请', () => {
  test('创建家庭，按用户名邀请，被邀请的人立刻看到这个家庭', async ({ browser }) => {
    const alice = await makeUser({ prefix: 'alice' });
    const bob = await makeUser({ prefix: 'bob' });
    const name = familyName();
    const a = await userPage(browser, alice);
    const b = await userPage(browser, bob);
    await createFamilyUi(a, name);

    await a.getByPlaceholder('用户名', { exact: true }).fill(bob.username);
    await a.getByRole('button', { name: '邀请', exact: true }).click();
    await expect(a.getByText('已邀请加入')).toBeVisible();
    await expect(a.locator('tbody tr', { hasText: bob.username })).toBeVisible();

    await b.reload();
    await goFamilyTab(b);
    await expect(b.getByRole('heading', { name })).toBeVisible();
    await expect(b.locator('tbody tr', { hasText: alice.username })).toBeVisible();
    await expect(b.getByRole('button', { name: '邀请', exact: true })).toHaveCount(0); // 非创建者没有邀请入口
    await a.context().close(); await b.context().close();
  });

  test('邀请不存在的用户 / 自己: 提示失败，成员不变', async ({ browser }) => {
    const alice = await makeUser({ prefix: 'alice' });
    const a = await userPage(browser, alice);
    await createFamilyUi(a, familyName());
    await a.getByPlaceholder('用户名', { exact: true }).fill('nobody_' + crypto.randomBytes(4).toString('hex'));
    await a.getByRole('button', { name: '邀请', exact: true }).click();
    await expect(a.getByText('邀请失败: 用户不存在')).toBeVisible();
    await a.getByPlaceholder('用户名', { exact: true }).fill(alice.username);
    await a.getByRole('button', { name: '邀请', exact: true }).click();
    await expect(a.getByText('邀请失败: 不能邀请自己')).toBeVisible();
    await a.context().close();
  });

  test('家庭名称全站唯一: 重名创建被拒绝', async ({ browser }) => {
    const alice = await makeUser({ prefix: 'alice' });
    const carol = await makeUser({ prefix: 'carol' });
    const name = familyName();
    const a = await userPage(browser, alice);
    await createFamilyUi(a, name);
    const c = await userPage(browser, carol);
    await goFamilyTab(c);
    await c.getByPlaceholder('家庭名称', { exact: true }).fill(name);
    await c.getByRole('button', { name: '创建', exact: true }).click();
    await expect(c.getByText(/创建失败.*已被使用/)).toBeVisible();
    await a.context().close(); await c.context().close();
  });
});

test.describe('申请与审批', () => {
  test('申请加入: 创建者通过后，申请人成为成员', async ({ browser }) => {
    const alice = await makeUser({ prefix: 'alice' });
    const dave = await makeUser({ prefix: 'dave' });
    const name = familyName();
    const a = await userPage(browser, alice);
    await createFamilyUi(a, name);
    const d = await userPage(browser, dave);
    await goFamilyTab(d);
    await d.getByPlaceholder('要加入的家庭名称').fill(name);
    await d.getByRole('button', { name: '申请加入' }).click();
    await expect(d.getByText('已提交申请，等待创建者审核')).toBeVisible();
    await expect(d.locator('tbody tr', { hasText: name })).toBeVisible(); // "我的申请"

    await a.reload();
    await goFamilyTab(a);
    const pending = a.locator('tbody tr', { hasText: dave.username });
    await expect(pending).toBeVisible();
    await pending.getByRole('button', { name: '通过' }).click();
    await expect(a.locator('tbody tr', { hasText: dave.username }).getByRole('button', { name: '移除' })).toBeVisible(); // 已成为成员

    await d.reload();
    await goFamilyTab(d);
    await expect(d.getByRole('heading', { name })).toBeVisible();
    await a.context().close(); await d.context().close();
  });

  test('创建者拒绝申请: 申请人仍不在家庭里', async ({ browser }) => {
    const alice = await makeUser({ prefix: 'alice' });
    const erin = await makeUser({ prefix: 'erin' });
    const name = familyName();
    const a = await userPage(browser, alice);
    await createFamilyUi(a, name);
    const e = await userPage(browser, erin);
    await goFamilyTab(e);
    await e.getByPlaceholder('要加入的家庭名称').fill(name);
    await e.getByRole('button', { name: '申请加入' }).click();
    await expect(e.getByText('已提交申请，等待创建者审核')).toBeVisible();

    await a.reload();
    await goFamilyTab(a);
    await a.locator('tbody tr', { hasText: erin.username }).getByRole('button', { name: '拒绝' }).click();
    await expect(a.getByText('暂无待审核申请')).toBeVisible();

    await e.reload();
    await goFamilyTab(e);
    await expect(e.getByRole('heading', { name: '创建新家庭' })).toBeVisible();
    await a.context().close(); await e.context().close();
  });

  test('申请不存在的家庭: 提示失败；申请人可以撤回自己的申请', async ({ browser }) => {
    const alice = await makeUser({ prefix: 'alice' });
    const frank = await makeUser({ prefix: 'frank' });
    const name = familyName();
    const a = await userPage(browser, alice);
    await createFamilyUi(a, name);
    const f = await userPage(browser, frank);
    await goFamilyTab(f);
    await f.getByPlaceholder('要加入的家庭名称').fill('不存在的家庭' + crypto.randomBytes(3).toString('hex'));
    await f.getByRole('button', { name: '申请加入' }).click();
    await expect(f.getByText(/申请失败.*未找到该家庭/)).toBeVisible();

    await f.getByPlaceholder('要加入的家庭名称').fill(name);
    await f.getByRole('button', { name: '申请加入' }).click();
    const mine = f.locator('tbody tr', { hasText: name });
    await expect(mine).toBeVisible();
    await mine.getByRole('button', { name: '撤回' }).click();
    await expect(mine).toHaveCount(0);
    await a.reload();
    await goFamilyTab(a);
    await expect(a.getByText('暂无待审核申请')).toBeVisible();
    await a.context().close(); await f.context().close();
  });
});

test.describe('退出', () => {
  test('普通成员退出家庭: 回到"创建/申请"界面，创建者的成员列表里不再有他', async ({ browser }) => {
    const alice = await makeUser({ prefix: 'alice' });
    const gina = await makeUser({ prefix: 'gina' });
    const name = familyName();
    const a = await userPage(browser, alice);
    await createFamilyUi(a, name);
    await a.getByPlaceholder('用户名', { exact: true }).fill(gina.username);
    await a.getByRole('button', { name: '邀请', exact: true }).click();
    await expect(a.getByText('已邀请加入')).toBeVisible();

    const g = await userPage(browser, gina);
    await goFamilyTab(g);
    await expect(g.getByRole('heading', { name })).toBeVisible();
    g.once('dialog', (d) => d.accept());
    await g.getByRole('button', { name: '退出家庭' }).click();
    await expect(g.getByRole('heading', { name: '创建新家庭' })).toBeVisible();

    await a.reload();
    await goFamilyTab(a);
    await expect(a.locator('tbody tr', { hasText: gina.username })).toHaveCount(0);
    await a.context().close(); await g.context().close();
  });

  test('还有其他成员时创建者不能直接退出(要先转让)', async ({ browser }) => {
    const alice = await makeUser({ prefix: 'alice' });
    const hank = await makeUser({ prefix: 'hank' });
    const name = familyName();
    const a = await userPage(browser, alice);
    await createFamilyUi(a, name);
    await a.getByPlaceholder('用户名', { exact: true }).fill(hank.username);
    await a.getByRole('button', { name: '邀请', exact: true }).click();
    await expect(a.getByText('已邀请加入')).toBeVisible();
    a.once('dialog', (d) => d.accept());
    await a.getByRole('button', { name: '退出家庭' }).click();
    await expect(a.getByText(/退出失败.*转让/)).toBeVisible();
    await expect(a.getByRole('heading', { name })).toBeVisible();
    await a.context().close();
  });
});
