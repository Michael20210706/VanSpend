import bcrypt from 'bcryptjs';
import dbApi from '@/src/db.cjs';
import { getSession } from '@/src/session';
import { jar } from './cookieJar.js';

let seq = 0;
export const uniq = (prefix) => `${prefix}_${process.pid}_${Date.now()}_${++seq}`;

// 建一个测试用户；password 给了就存真实 bcrypt 哈希，便于测登录
export async function makeUser({ admin = false, password } = {}) {
  const username = uniq('u');
  const hash = password ? await bcrypt.hash(password, 4) : 'not-a-real-hash';
  const id = await dbApi.createUser(username, hash);
  if (admin) await dbApi.pool.execute('UPDATE users SET is_admin = 1 WHERE id = :id', { id });
  return { id, username, password };
}

// 建家庭并把 members 拉进去(第一个是创建者)
export async function makeFamily(creator, ...members) {
  const familyId = await dbApi.createFamily(uniq('fam'), creator.id);
  for (const m of members) {
    await dbApi.pool.execute(
      "UPDATE users SET family_id = :familyId, account_type = 'family' WHERE id = :id",
      { familyId, id: m.id }
    );
  }
  return familyId;
}

// 以某个用户身份写入会话 cookie。extra 用来故意写入"过期"的缓存字段，验证服务端不再信任它们。
export async function loginAs(user, extra = {}) {
  jar.clear();
  const s = await getSession();
  s.userId = user.id;
  s.username = user.username;
  Object.assign(s, extra);
  await s.save();
}

export function logout() {
  jar.clear();
}

export function req(url, { method = 'GET', body, headers = {} } = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    init.headers['content-type'] = 'application/json';
  }
  return new Request('http://localhost' + url, init);
}

export const ctx = (params) => ({ params: Promise.resolve(params) });

// 直接插一张小票(可带原图文件名)，返回 id
export async function makeReceipt(user, { familyId = null, imageFile = null, total = 10 } = {}) {
  return dbApi.saveReceipt(
    {
      user_id: user.id, family_id: familyId, account_type: familyId ? 'family' : 'individual',
      store: '__TEST', purchased_at: '2026-05-01', currency: 'CAD',
      subtotal: total, gst: 0, pst: 0, total, image_file: imageFile, raw_json: '{}',
    },
    [{ name_raw: 'X', name_norm: 'x', category: '其他', subcategory: null, qty: 1, unit: null, unit_price: total, amount: total, taxable: 0 }]
  );
}
