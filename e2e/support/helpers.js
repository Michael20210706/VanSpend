// 各 spec 共用的小工具。每个 spec 自己建账号(随机用户名)，互不依赖，也不依赖执行顺序。
import crypto from 'crypto';
import { createRequire } from 'module';
import bcrypt from 'bcryptjs';
import { expect, request as pwRequest } from '@playwright/test';
import { BASE_URL } from './env.js';

const require = createRequire(import.meta.url);
// worker 进程里直接用应用自己的 db 模块种数据(env 已由主进程注入，连的是 vanspend_e2e_test)
export const dbApi = require('../../src/db.cjs');

export const PASSWORD = () => process.env.E2E_PASSWORD;
const uniq = (prefix) => `${prefix}_${crypto.randomBytes(5).toString('hex')}`;

export async function makeUser({ prefix = 'u', username } = {}) {
  const name = username || uniq(prefix);
  const id = await dbApi.createUser(name, await bcrypt.hash(PASSWORD(), 4));
  return { id, username: name };
}

export const adminUser = () => ({ username: process.env.ADMIN_USERNAME });

// 建家庭并把成员拉进去(第一个参数是创建者)，与 tests/helpers.js 的 makeFamily 同一做法
export async function makeFamily(creator, ...members) {
  const familyId = await dbApi.createFamily(uniq('fam'), creator.id);
  for (const m of members) {
    await dbApi.pool.execute("UPDATE users SET family_id = :familyId, account_type = 'family' WHERE id = :id", { familyId, id: m.id });
  }
  return familyId;
}

export async function makeInviteCode(user) {
  const row = await dbApi.createInviteCode(user.id);
  return row.code;
}

// 直接写一张小票。家庭内的小票要带 family_id(应用保存时也是这样盖章)
export async function makeReceipt(user, { familyId = null, store = '种子商店', total = 10 } = {}) {
  return dbApi.saveReceipt(
    {
      user_id: user.id, family_id: familyId, account_type: familyId ? 'family' : 'individual',
      store, purchased_at: '2026-05-01', currency: 'CAD', subtotal: total, gst: 0, pst: 0, total, image_file: null, raw_json: '{}',
    },
    [{ name_raw: 'X', name_norm: 'x', category: '其他', subcategory: null, qty: 1, unit: null, unit_price: total, amount: total, taxable: 0 }]
  );
}

// 用 API 登录: 会话 cookie 写进 page 所在的浏览器上下文(page.request 与页面共享 cookie)
export async function loginApi(page, user, password = PASSWORD()) {
  const r = await page.request.post('/api/auth/login', { data: { username: user.username, password } });
  expect(r.status(), 'API 登录').toBe(200);
}

// 独立于页面的 API 上下文(比如管理员在"另一个设备"上操作)
export async function apiContextFor(user, password = PASSWORD()) {
  const ctx = await pwRequest.newContext({ baseURL: BASE_URL });
  const r = await ctx.post('/api/auth/login', { data: { username: user.username, password } });
  expect(r.status(), '独立上下文登录').toBe(200);
  return ctx;
}

export async function loginUi(page, user, password = PASSWORD()) {
  await page.goto('/login');
  await page.getByPlaceholder('用户名').fill(user.username);
  await page.getByPlaceholder('密码').fill(password);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByRole('link', { name: '退出' })).toBeVisible();
}

// 收集页面里未处理的 promise rejection 和脚本错误。必须在 goto 之前调用
export async function trackErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    window.addEventListener('unhandledrejection', (e) => {
      (window.__rejections ||= []).push(String(e.reason));
    });
  });
  return { errors, rejections: () => page.evaluate(() => window.__rejections || []) };
}

// 1x1 PNG，够过前端的读图和服务端的 data URL 校验
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

export const horizontalOverflow = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
