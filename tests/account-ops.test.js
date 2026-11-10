// P4: 管理员重置密码(用户下次必须先改)、自助注销账号、管理员操作日志
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import dbApi from '@/src/db.cjs';
import * as resetRoute from '@/app/api/admin/users/[id]/reset-password/route.js';
import * as userIdRoute from '@/app/api/admin/users/[id]/route.js';
import * as adminReceiptRoute from '@/app/api/admin/receipts/[id]/route.js';
import * as adminReceiptsRoute from '@/app/api/admin/receipts/route.js';
import * as adminUsersRoute from '@/app/api/admin/users/route.js';
import * as auditRoute from '@/app/api/admin/audit/route.js';
import * as loginRoute from '@/app/api/auth/login/route.js';
import * as meRoute from '@/app/api/auth/me/route.js';
import * as passwordRoute from '@/app/api/auth/password/route.js';
import * as deleteRoute from '@/app/api/auth/delete-account/route.js';
import * as logoutRoute from '@/app/api/auth/logout/route.js';
import * as receiptsRoute from '@/app/api/receipts/route.js';
import * as invitesRoute from '@/app/api/invites/route.js';
import * as familyMeRoute from '@/app/api/family/me/route.js';
import * as uploadsRoute from '@/app/uploads/[...file]/route.js';
import { makeUser, makeFamily, makeReceipt, loginAs, logout, req, ctx, uniq } from './helpers.js';

const resetPw = (id) => resetRoute.POST(req('/x', { method: 'POST' }), ctx({ id: String(id) }));
const login = (username, password) =>
  loginRoute.POST(req('/api/auth/login', { method: 'POST', body: { username, password }, headers: { 'cf-connecting-ip': `10.9.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}` } }));
const changePw = (currentPassword, newPassword) =>
  passwordRoute.POST(req('/api/auth/password', { method: 'POST', body: { currentPassword, newPassword } }));
const del = (password) => deleteRoute.POST(req('/api/auth/delete-account', { method: 'POST', body: password === undefined ? {} : { password } }));
const audit = async (query = '') => (await auditRoute.GET(req('/api/admin/audit' + query))).json();
const auditFor = async (targetId, action) => (await audit('?limit=500')).filter((r) => r.target_id === targetId && r.action === action);
const exists = async (id) => (await dbApi.pool.query('SELECT 1 FROM users WHERE id = ?', [id]))[0].length === 1;
const flagOf = async (id) => (await dbApi.pool.query('SELECT must_change_password m FROM users WHERE id = ?', [id]))[0][0].m;

function writeImage(name) {
  fs.writeFileSync(path.join(process.env.UPLOAD_DIR, name), Buffer.from('fake-image'));
  return name;
}
const onDisk = (name) => fs.existsSync(path.join(process.env.UPLOAD_DIR, name));

describe('管理员重置密码', () => {
  it('管理员重置 → 返回一次性临时密码；原密码立即失效，临时密码能登录；库里标志置 1，响应禁止缓存', async () => {
    const target = await makeUser({ password: 'old-pass-1' });
    const admin = await makeUser({ admin: true });
    await loginAs(admin);
    const res = await resetPw(target.id);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const { temporaryPassword } = await res.json();
    expect(temporaryPassword).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(await flagOf(target.id)).toBe(1);
    logout();
    expect((await login(target.username, 'old-pass-1')).status).toBe(401);
    expect((await login(target.username, temporaryPassword)).status).toBe(200);
  });

  it('每次重置的临时密码都不一样；库里存的是哈希，不是明文', async () => {
    const target = await makeUser({ password: 'x-pass-1' });
    await loginAs(await makeUser({ admin: true }));
    const a = (await (await resetPw(target.id)).json()).temporaryPassword;
    const b = (await (await resetPw(target.id)).json()).temporaryPassword;
    expect(a).not.toBe(b);
    const [[u]] = await dbApi.pool.query('SELECT password_hash FROM users WHERE id = ?', [target.id]);
    expect(u.password_hash).not.toContain(b);
    expect(u.password_hash.startsWith('$2')).toBe(true);
  });

  it('权限(反例): 普通用户 403、未登录 401、不存在 404、非数字 id 400、重置自己 400、重置管理员账号 400；这些都不改任何数据', async () => {
    const target = await makeUser({ password: 'keep-pass' });
    const otherAdmin = await makeUser({ admin: true, password: 'admin-pass' });
    await loginAs(await makeUser());
    expect((await resetPw(target.id)).status).toBe(403);
    logout();
    expect((await resetPw(target.id)).status).toBe(401);
    const admin = await makeUser({ admin: true });
    await loginAs(admin);
    expect((await resetPw(99999999)).status).toBe(404);
    expect((await resetRoute.POST(req('/x', { method: 'POST' }), ctx({ id: '1abc' }))).status).toBe(400);
    expect((await resetPw(admin.id)).status).toBe(400);
    expect((await resetPw(otherAdmin.id)).status).toBe(400);
    expect(await flagOf(target.id)).toBe(0);
    expect(await flagOf(otherAdmin.id)).toBe(0);
    logout();
    expect((await login(target.username, 'keep-pass')).status).toBe(200);
    expect((await login(otherAdmin.username, 'admin-pass')).status).toBe(200);
  });
});

describe('必须先改密码(重置后的账号)', () => {
  async function resetUser() {
    const target = await makeUser({ password: 'old-pass-1' });
    await loginAs(await makeUser({ admin: true }));
    const { temporaryPassword } = await (await resetPw(target.id)).json();
    return { target, temp: temporaryPassword };
  }

  it('改密码之前: /api/auth/me 照常(带标志)，其余接口一律 403 password_change_required', async () => {
    const { target } = await resetUser();
    await loginAs(target);
    const me = await (await meRoute.GET()).json();
    expect(me.mustChangePassword).toBe(true);
    for (const call of [
      () => receiptsRoute.GET(req('/api/receipts')),
      () => familyMeRoute.GET(req('/api/family/me')),
      () => invitesRoute.GET(req('/api/invites')),
      () => del('anything'),
    ]) {
      const res = await call();
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe('password_change_required');
    }
  });

  it('原图也不给(404，和无权一视同仁)', async () => {
    const target = await makeUser({ password: 'old-pass-1' });
    const file = writeImage(uniq('img') + '.jpg');
    await makeReceipt(target, { imageFile: file });
    await loginAs(target);
    expect((await uploadsRoute.GET(req('/uploads/' + file), ctx({ file: [file] }))).status).toBe(200);
    await loginAs(await makeUser({ admin: true }));
    const { id } = target;
    expect((await resetPw(id)).status).toBe(200);
    await loginAs(target);
    expect((await uploadsRoute.GET(req('/uploads/' + file), ctx({ file: [file] }))).status).toBe(404);
  });

  it('已经登录的其他设备(旧 cookie)同样被拦: 标志是每个请求从库里读的', async () => {
    const target = await makeUser({ password: 'old-pass-1' });
    await loginAs(target);
    expect((await receiptsRoute.GET(req('/api/receipts'))).status).toBe(200);
    // 管理员在另一处重置；用户手里那份 cookie 没变，仍然写着 userId
    await dbApi.pool.execute('UPDATE users SET must_change_password = 1 WHERE id = ?', [target.id]);
    expect((await receiptsRoute.GET(req('/api/receipts'))).status).toBe(403);
  });

  it('退出登录仍然可用', async () => {
    const { target } = await resetUser();
    await loginAs(target);
    expect((await logoutRoute.POST()).status).toBe(200);
  });

  it('用临时密码改成新密码 → 标志清零、恢复正常；旧的临时密码失效', async () => {
    const { target, temp } = await resetUser();
    await loginAs(target);
    expect((await changePw(temp, 'brand-new-pass')).status).toBe(200);
    expect(await flagOf(target.id)).toBe(0);
    expect((await receiptsRoute.GET(req('/api/receipts'))).status).toBe(200);
    expect((await (await meRoute.GET()).json()).mustChangePassword).toBe(false);
    logout();
    expect((await login(target.username, temp)).status).toBe(401);
    expect((await login(target.username, 'brand-new-pass')).status).toBe(200);
  });

  it('改密码时: 当前密码不对 401、新密码和当前相同 400、缺字段 400；标志都不清', async () => {
    const { target, temp } = await resetUser();
    await loginAs(target);
    expect((await changePw('wrong', 'brand-new-pass')).status).toBe(401);
    expect((await changePw(temp, temp)).status).toBe(400);
    expect((await changePw(temp, '')).status).toBe(400);
    expect(await flagOf(target.id)).toBe(1);
  });

  it('普通改密码(没被重置过)不受影响: 能改、标志本来就是 0', async () => {
    const u = await makeUser({ password: 'plain-pass-1' });
    await loginAs(u);
    expect((await changePw('plain-pass-1', 'plain-pass-2')).status).toBe(200);
    expect(await flagOf(u.id)).toBe(0);
  });
});

describe('自助注销账号', () => {
  async function userWithData(password = 'my-pass-1') {
    const u = await makeUser({ password });
    const f1 = writeImage(uniq('img') + '.jpg');
    const f2 = writeImage(uniq('img') + '.png');
    const r1 = await makeReceipt(u, { imageFile: f1 });
    const r2 = await makeReceipt(u, { imageFile: f2 });
    return { u, files: [f1, f2], receipts: [r1, r2] };
  }

  it('密码正确 → 账号、小票、明细、原图文件全部删除，会话被清掉', async () => {
    const { u, files, receipts } = await userWithData();
    await loginAs(u);
    expect(files.every(onDisk)).toBe(true);
    const res = await del('my-pass-1');
    expect(res.status).toBe(200);
    expect(await exists(u.id)).toBe(false);
    for (const id of receipts) {
      expect((await dbApi.pool.query('SELECT 1 FROM receipts WHERE id = ?', [id]))[0]).toHaveLength(0);
      expect((await dbApi.pool.query('SELECT 1 FROM items WHERE receipt_id = ?', [id]))[0]).toHaveLength(0);
    }
    expect(files.some(onDisk)).toBe(false);
    expect((await meRoute.GET()).status).toBe(401); // 会话已销毁
  });

  it('密码错误 401、缺密码 400、未登录 401 → 什么都不删', async () => {
    const { u, files } = await userWithData();
    await loginAs(u);
    expect((await del('wrong')).status).toBe(401);
    expect((await del()).status).toBe(400);
    expect((await del('')).status).toBe(400);
    expect((await deleteRoute.POST(req('/x', { method: 'POST', body: { password: ['my-pass-1'] } }))).status).toBe(400);
    logout();
    expect((await del('my-pass-1')).status).toBe(401);
    expect(await exists(u.id)).toBe(true);
    expect(files.every(onDisk)).toBe(true);
  });

  it('只删自己的: 别人的账号、小票、原图不受影响；同家庭其他成员的小票也在', async () => {
    const a = await makeUser({ password: 'pw-a-1234' });
    const b = await makeUser();
    await makeFamily(b, a);
    const fa = writeImage(uniq('img') + '.jpg');
    const fb = writeImage(uniq('img') + '.jpg');
    await makeReceipt(a, { imageFile: fa });
    const rb = await makeReceipt(b, { imageFile: fb });
    await loginAs(a);
    expect((await del('pw-a-1234')).status).toBe(200);
    expect(onDisk(fa)).toBe(false);
    expect(onDisk(fb)).toBe(true);
    expect(await exists(b.id)).toBe(true);
    expect((await dbApi.pool.query('SELECT 1 FROM receipts WHERE id = ?', [rb]))[0]).toHaveLength(1);
    // 家庭还在，成员只少了一个
    const members = (await dbApi.pool.query('SELECT id FROM users WHERE family_id = (SELECT family_id FROM users WHERE id = ?)', [b.id]))[0];
    expect(members.map((m) => m.id)).toEqual([b.id]);
  });

  it('家庭创建者(还有其他成员)→ 400，须先转让；转让后能注销', async () => {
    const creator = await makeUser({ password: 'creator-pw1' });
    const member = await makeUser();
    const familyId = await makeFamily(creator, member);
    await loginAs(creator);
    const res = await del('creator-pw1');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('转让');
    expect(await exists(creator.id)).toBe(true);
    expect(await dbApi.transferCreator(familyId, creator.id, member.id)).toBeTruthy();
    expect((await del('creator-pw1')).status).toBe(200);
    expect(await exists(creator.id)).toBe(false);
  });

  it('独自一人的家庭创建者也要先解散(400)；解散后能注销', async () => {
    const creator = await makeUser({ password: 'creator-pw2' });
    const familyId = await makeFamily(creator);
    const name = (await dbApi.pool.query('SELECT name FROM families WHERE id = ?', [familyId]))[0][0].name;
    await loginAs(creator);
    expect((await del('creator-pw2')).status).toBe(400);
    expect(await dbApi.dissolveFamily(familyId, creator.id, name)).toBeTruthy();
    expect((await del('creator-pw2')).status).toBe(200);
  });

  it('管理员账号不能自助注销(403)', async () => {
    const admin = await makeUser({ admin: true, password: 'admin-pw-1' });
    await loginAs(admin);
    expect((await del('admin-pw-1')).status).toBe(403);
    expect(await exists(admin.id)).toBe(true);
  });

  it('待审的家庭申请、没用掉的邀请码随账号一起清掉(外键级联)', async () => {
    const creator = await makeUser();
    const familyId = await makeFamily(creator);
    const applicant = await makeUser({ password: 'applicant-pw' });
    await dbApi.applyToFamily(familyId, applicant.id);
    await loginAs(applicant);
    expect((await del('applicant-pw')).status).toBe(200);
    expect((await dbApi.pool.query('SELECT 1 FROM family_join_requests WHERE user_id = ?', [applicant.id]))[0]).toHaveLength(0);
  });

  it('与家庭管理并发: 成员注销 vs 创建者解散/转让，不死锁、不留半截数据', async () => {
    for (let round = 0; round < 8; round++) {
      const creator = await makeUser();
      const member = await makeUser({ password: 'member-pw-1' });
      const familyId = await makeFamily(creator, member);
      const rid = await makeReceipt(member, { familyId });
      const [[{ name }]] = await dbApi.pool.query('SELECT name FROM families WHERE id = ?', [familyId]);
      const results = await Promise.allSettled([
        dbApi.deleteOwnAccount(member.id),
        round % 2 ? dbApi.dissolveFamily(familyId, creator.id, name) : dbApi.removeMember(familyId, creator.id, member.id),
      ]);
      for (const r of results) expect(r.status).toBe('fulfilled');
      expect(await exists(member.id)).toBe(false);
      expect((await dbApi.pool.query('SELECT 1 FROM receipts WHERE id = ?', [rid]))[0]).toHaveLength(0);
    }
  });
});

describe('管理员操作日志', () => {
  it('删除用户 → 记一条 delete_user(操作人、对象快照、连带小票数)；图片文件随之删除', async () => {
    const admin = await makeUser({ admin: true });
    const target = await makeUser();
    const file = writeImage(uniq('img') + '.jpg');
    await makeReceipt(target, { imageFile: file });
    await loginAs(admin);
    const res = await userIdRoute.DELETE(req('/x', { method: 'DELETE' }), ctx({ id: String(target.id) }));
    expect(res.status).toBe(200);
    expect(onDisk(file)).toBe(false);
    const rows = await auditFor(target.id, 'delete_user');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ admin_id: admin.id, admin_username: admin.username, target_type: 'user', target_label: target.username });
    expect(rows[0].detail).toContain('1 张小票');
    expect(rows[0].created_at).toBeTruthy();
  });

  it('删除小票 → 记 delete_receipt(店名/日期/金额快照 + 所有者)', async () => {
    const admin = await makeUser({ admin: true });
    const owner = await makeUser();
    const id = await makeReceipt(owner, { total: 12.5 });
    await loginAs(admin);
    const res = await adminReceiptRoute.DELETE(req('/x', { method: 'DELETE' }), ctx({ id: String(id) }));
    expect((await res.json()).deleted).toBe(1);
    const rows = await auditFor(id, 'delete_receipt');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ admin_username: admin.username, target_type: 'receipt' });
    expect(rows[0].target_label).toContain('__TEST');
    expect(rows[0].target_label).toContain('12.50');
    expect(rows[0].detail).toContain(owner.username);
  });

  it('重置密码 → 记 reset_password，日志里不含临时密码', async () => {
    const admin = await makeUser({ admin: true });
    const target = await makeUser();
    await loginAs(admin);
    const { temporaryPassword } = await (await resetPw(target.id)).json();
    const rows = await auditFor(target.id, 'reset_password');
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toContain(temporaryPassword);
    expect(rows[0].admin_id).toBe(admin.id);
  });

  it('调整额度 → 记 set_tier(含前后档位)', async () => {
    const admin = await makeUser({ admin: true });
    const target = await makeUser({ tier: 'open' });
    await loginAs(admin);
    const res = await userIdRoute.PATCH(req('/x', { method: 'PATCH', body: { tier: 'normal' } }), ctx({ id: String(target.id) }));
    expect(res.status).toBe(200);
    const rows = await auditFor(target.id, 'set_tier');
    expect(rows).toHaveLength(1);
    expect(rows[0].detail).toContain('open');
    expect(rows[0].detail).toContain('normal');
  });

  it('不记录查看: 看用户列表、小票列表、日志本身都不新增日志', async () => {
    const admin = await makeUser({ admin: true });
    await loginAs(admin);
    const before = (await audit('?limit=500')).length;
    await adminUsersRoute.GET(req('/api/admin/users'));
    await adminReceiptsRoute.GET(req('/api/admin/receipts'));
    await audit();
    expect((await audit('?limit=500')).length).toBe(before);
  });

  it('没发生写入的失败操作不记录: 不存在的用户/小票/重置失败/被拒的普通用户请求', async () => {
    const admin = await makeUser({ admin: true });
    await loginAs(admin);
    const before = (await audit('?limit=500')).length;
    await userIdRoute.DELETE(req('/x', { method: 'DELETE' }), ctx({ id: '99999999' }));
    await userIdRoute.PATCH(req('/x', { method: 'PATCH', body: { tier: 'normal' } }), ctx({ id: '99999999' }));
    await userIdRoute.PATCH(req('/x', { method: 'PATCH', body: { tier: 'bogus' } }), ctx({ id: String(admin.id) }));
    await userIdRoute.DELETE(req('/x', { method: 'DELETE' }), ctx({ id: String(admin.id) })); // 删自己被拒
    await adminReceiptRoute.DELETE(req('/x', { method: 'DELETE' }), ctx({ id: '99999999' }));
    await resetPw(99999999);
    await resetPw(admin.id);
    await loginAs(await makeUser());
    await userIdRoute.DELETE(req('/x', { method: 'DELETE' }), ctx({ id: String(admin.id) }));
    await adminReceiptRoute.DELETE(req('/x', { method: 'DELETE' }), ctx({ id: '1' }));
    await loginAs(admin);
    expect((await audit('?limit=500')).length).toBe(before);
  });

  it('用户自助注销不是管理员操作，不进管理员日志', async () => {
    const admin = await makeUser({ admin: true });
    const u = await makeUser({ password: 'self-pw-1' });
    await loginAs(admin);
    const before = (await audit('?limit=500')).length;
    await loginAs(u);
    await del('self-pw-1');
    await loginAs(admin);
    expect((await audit('?limit=500')).length).toBe(before);
  });

  it('读日志: 仅管理员(普通用户 403、未登录 401)；最新在前；limit 生效且有上限', async () => {
    const admin = await makeUser({ admin: true });
    await loginAs(admin);
    for (let i = 0; i < 3; i++) await userIdRoute.PATCH(req('/x', { method: 'PATCH', body: { tier: 'open' } }), ctx({ id: String((await makeUser()).id) }));
    const all = await audit('?limit=500');
    for (let i = 1; i < all.length; i++) expect(all[i - 1].id).toBeGreaterThan(all[i].id);
    expect(await audit('?limit=2')).toHaveLength(2);
    expect((await audit('?limit=999999')).length).toBeLessThanOrEqual(500);
    await loginAs(await makeUser());
    expect((await auditRoute.GET(req('/api/admin/audit'))).status).toBe(403);
    logout();
    expect((await auditRoute.GET(req('/api/admin/audit'))).status).toBe(401);
  });

  it('日志只读: 路由只导出 GET，没有改/删日志的接口', () => {
    expect(Object.keys(auditRoute).sort()).toEqual(['GET']);
  });

  it('对象被删、操作人账号被删之后，日志仍然保留(文字快照，admin_id 置空)', async () => {
    const admin = await makeUser({ admin: true });
    const target = await makeUser();
    await loginAs(admin);
    await resetPw(target.id);
    await dbApi.deleteUser(target.id);
    await dbApi.deleteUser(admin.id);
    const [rows] = await dbApi.pool.query("SELECT * FROM admin_audit_log WHERE target_id = ? AND action = 'reset_password'", [target.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].admin_id).toBeNull();
    expect(rows[0].admin_username).toBe(admin.username);
    expect(rows[0].target_label).toBe(target.username);
  });

  it('日志和操作在同一事务: 写日志失败时操作回滚', async () => {
    const target = await makeUser({ tier: 'open' });
    // 故意给一个不存在的操作人 id: 日志的外键写入失败，额度修改必须跟着回滚
    await expect(dbApi.setScanTier(target.id, 'normal', { id: 99999999, username: 'ghost' })).rejects.toThrow();
    const [[u]] = await dbApi.pool.query('SELECT scan_tier FROM users WHERE id = ?', [target.id]);
    expect(u.scan_tier).toBe('open');
  });
});
