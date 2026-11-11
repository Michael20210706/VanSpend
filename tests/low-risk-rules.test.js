// issue #37 里低风险的接口与规则小项
import { describe, it, expect } from 'vitest';
import dbApi from '@/src/db.cjs';
import captchaApi from '@/src/captcha.cjs';
import * as tierRoute from '@/app/api/admin/users/[id]/route.js';
import * as adminReceiptRoute from '@/app/api/admin/receipts/[id]/route.js';
import * as receiptsRoute from '@/app/api/receipts/route.js';
import * as registerRoute from '@/app/api/auth/register/route.js';
import * as familyRoute from '@/app/api/family/route.js';
import * as applyRoute from '@/app/api/family/apply/route.js';
import * as inviteRoute from '@/app/api/family/invite/route.js';
import { makeUser, makeReceipt, loginAs, req, ctx, uniq } from './helpers.js';

const patchTier = (id, tier) => tierRoute.PATCH(req('/x', { method: 'PATCH', body: { tier } }), ctx({ id: String(id) }));
const auditCount = async (userId) => (await dbApi.pool.query("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'set_tier' AND target_id = ?", [userId]))[0][0].n;

describe('管理员把额度改成同一个值: 不写审计日志', () => {
  it('不同值 → 写一行；同一个值 → 仍 200，但不再写；之后再改回不同值 → 又写一行', async () => {
    const admin = await makeUser({ admin: true });
    const target = await makeUser(); // 默认 normal
    await loginAs(admin);
    expect((await patchTier(target.id, 'normal')).status).toBe(200);
    expect(await auditCount(target.id)).toBe(0);
    expect((await patchTier(target.id, 'open')).status).toBe(200);
    expect(await auditCount(target.id)).toBe(1);
    expect((await patchTier(target.id, 'open')).status).toBe(200);
    expect(await auditCount(target.id)).toBe(1);
    expect((await patchTier(target.id, 'normal')).status).toBe(200);
    expect(await auditCount(target.id)).toBe(2);
  });
  it('额度同值时也不会重复撤销邀请码以外的东西: 用户的档位保持不变', async () => {
    const admin = await makeUser({ admin: true });
    const target = await makeUser({ tier: 'open' });
    await loginAs(admin);
    await patchTier(target.id, 'open');
    const [[row]] = await dbApi.pool.query('SELECT scan_tier FROM users WHERE id = ?', [target.id]);
    expect(row.scan_tier).toBe('open');
  });
});

describe('管理员删除不存在的资源 → 404', () => {
  it('删除不存在的用户 → 404；删除已存在的用户 → 200 {deleted:1}', async () => {
    const admin = await makeUser({ admin: true });
    await loginAs(admin);
    expect((await tierRoute.DELETE(req('/x', { method: 'DELETE' }), ctx({ id: '999999999' }))).status).toBe(404);
    const target = await makeUser();
    const ok = await tierRoute.DELETE(req('/x', { method: 'DELETE' }), ctx({ id: String(target.id) }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).deleted).toBe(1);
    expect((await tierRoute.DELETE(req('/x', { method: 'DELETE' }), ctx({ id: String(target.id) }))).status).toBe(404);
  });
  it('删除不存在的小票 → 404；已存在的 → 200', async () => {
    const admin = await makeUser({ admin: true });
    const owner = await makeUser();
    const rid = await makeReceipt(owner);
    await loginAs(admin);
    expect((await adminReceiptRoute.DELETE(req('/x', { method: 'DELETE' }), ctx({ id: '999999999' }))).status).toBe(404);
    expect((await adminReceiptRoute.DELETE(req('/x', { method: 'DELETE' }), ctx({ id: String(rid) }))).status).toBe(200);
    expect((await adminReceiptRoute.DELETE(req('/x', { method: 'DELETE' }), ctx({ id: String(rid) }))).status).toBe(404);
  });
});

describe('搜索里的 % 和 _ 按字面匹配', () => {
  async function saveStore(user, store) {
    return dbApi.saveReceipt(
      { user_id: user.id, family_id: null, account_type: 'individual', store, purchased_at: '2026-05-01', currency: 'CAD', subtotal: 1, gst: 0, pst: 0, total: 1, image_file: null, raw_json: '{}' },
      [{ name_raw: 'plain', name_norm: 'plain', category: '其他', subcategory: null, qty: 1, unit: null, unit_price: 1, amount: 1, taxable: 0 }]
    );
  }
  const search = async (q) => {
    const res = await receiptsRoute.GET(req('/api/receipts?search=' + encodeURIComponent(q)));
    return (await res.json()).map((r) => r.store);
  };
  it('% 不再匹配任意字符串；_ 不再匹配任意单个字符；普通子串仍然匹配', async () => {
    const u = await makeUser();
    const tag = uniq('s').replace(/_/g, '');
    await saveStore(u, `${tag}A%B`);
    await saveStore(u, `${tag}AxxB`);
    await saveStore(u, `${tag}C_D`);
    await saveStore(u, `${tag}CxD`);
    await loginAs(u);
    expect(await search(`${tag}A%B`)).toEqual([`${tag}A%B`]);
    expect(await search(`${tag}C_D`)).toEqual([`${tag}C_D`]);
    expect((await search(tag)).length).toBe(4);
    expect(await search('%')).toEqual([`${tag}A%B`]);
  });
});

describe('用户名/家庭名不能含控制字符', () => {
  const bad = ['a\nb', 'a\u0000b', 'a\tb', 'a\u007fb'];
  it('注册: 用户名含控制字符 → 400，正常用户名通过这一关(到验证码才被拒)', async () => {
    for (const name of bad) {
      const res = await registerRoute.POST(req('/x', { method: 'POST', body: { username: name, password: 'longenough', captchaToken: 'x', captchaAnswer: '1' } }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/控制字符/);
    }
    const ok = await registerRoute.POST(req('/x', { method: 'POST', body: { username: 'plain_name', password: 'longenough', captchaToken: 'x', captchaAnswer: '1' } }));
    expect((await ok.json()).error).not.toMatch(/控制字符/);
  });
  it('创建/申请家庭、邀请成员: 名称含控制字符 → 400', async () => {
    await loginAs(await makeUser());
    for (const name of bad) {
      for (const route of [familyRoute, applyRoute]) {
        const res = await route.POST(req('/x', { method: 'POST', body: { name } }));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/控制字符/);
      }
    }
    const good = await familyRoute.POST(req('/x', { method: 'POST', body: { name: uniq('fam') } }));
    expect(good.status).toBe(200);
    for (const username of bad) {
      const res = await inviteRoute.POST(req('/x', { method: 'POST', body: { username } }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/控制字符/);
    }
  });
});

describe('验证码答案必须是字符串', () => {
  it('数字或数组答案即使数值正确也不通过；字符串答案通过', () => {
    const { token } = captchaApi.generate();
    let n = null;
    for (let i = -9; i <= 18; i++) if (captchaApi.verify(token, String(i))) n = i;
    expect(n).not.toBeNull();
    expect(captchaApi.verify(token, String(n))).toBe(true);
    expect(captchaApi.verify(token, n)).toBe(false);
    expect(captchaApi.verify(token, [n])).toBe(false);
  });
});
