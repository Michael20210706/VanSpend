// P1 / Q7、Q15、Q16: 邀请码注册与开放注册并存；邀请码单次有效、过期/作废/重用都拒绝；家庭码注册后直接入家庭
import { describe, it, expect, vi, afterEach } from 'vitest';
import dbApi from '@/src/db.cjs';
import captchaApi from '@/src/captcha.cjs';
import * as registerRoute from '@/app/api/auth/register/route.js';
import * as invitesRoute from '@/app/api/invites/route.js';
import { makeUser, makeFamily, loginAs, logout, req, uniq } from './helpers.js';

afterEach(() => vi.restoreAllMocks());

const register = (body) => registerRoute.POST(req('/api/auth/register', { method: 'POST', body }));
const newCode = async (creator, family = false) => {
  await loginAs(creator);
  return (await invitesRoute.POST(req('/api/invites', { method: 'POST', body: { family } }))).json();
};
const userRow = async (username) => (await dbApi.pool.query('SELECT * FROM users WHERE username = ?', [username]))[0][0];

describe('开放注册(无邀请码)', () => {
  it('验证码通过 → 200，账号标记为 开放注册 / open 档', async () => {
    vi.spyOn(captchaApi, 'verify').mockReturnValue(true);
    logout();
    const username = uniq('open');
    const res = await register({ username, password: 'pw123456', captchaToken: 't', captchaAnswer: '1' });
    expect(res.status).toBe(200);
    const u = await userRow(username);
    expect(u.signup_source).toBe('open');
    expect(u.scan_tier).toBe('open');
    expect(u.invited_by).toBeNull();
  });

  it('验证码错误 → 400，不建账号', async () => {
    vi.spyOn(captchaApi, 'verify').mockReturnValue(false);
    logout();
    const username = uniq('open');
    expect((await register({ username, password: 'pw123456', captchaToken: 't', captchaAnswer: '9' })).status).toBe(400);
    expect(await userRow(username)).toBeUndefined();
  });

  it('不能自己声明 signupSource / scanTier / isAdmin(请求体里的这些字段被忽略)', async () => {
    vi.spyOn(captchaApi, 'verify').mockReturnValue(true);
    logout();
    const username = uniq('open');
    const res = await register({ username, password: 'pw123456', captchaToken: 't', captchaAnswer: '1', scanTier: 'normal', signupSource: 'invite', isAdmin: true });
    expect(res.status).toBe(200);
    const u = await userRow(username);
    expect(u.scan_tier).toBe('open');
    expect(u.signup_source).toBe('open');
    expect(u.is_admin).toBe(0);
  });
});

describe('邀请码注册', () => {
  it('有效码 → 200，不需要验证码；账号为 邀请注册 / normal 档，记录邀请人，码被标记已使用', async () => {
    const spy = vi.spyOn(captchaApi, 'verify').mockReturnValue(false); // 验证码一律失败，也必须能靠邀请码注册
    const inviter = await makeUser();
    const c = await newCode(inviter);
    logout();
    const username = uniq('inv');
    const res = await register({ username, password: 'pw123456', inviteCode: c.code });
    expect(res.status).toBe(200);
    expect(spy).not.toHaveBeenCalled();
    const u = await userRow(username);
    expect(u.signup_source).toBe('invite');
    expect(u.scan_tier).toBe('normal');
    expect(u.invited_by).toBe(inviter.id);
    const [[code]] = await dbApi.pool.query('SELECT used_by, used_at FROM invite_codes WHERE id = ?', [c.id]);
    expect(code.used_by).toBe(u.id);
    expect(code.used_at).not.toBeNull();
  });

  it('同一个码第二次使用 → 400，不建账号', async () => {
    const c = await newCode(await makeUser());
    logout();
    expect((await register({ username: uniq('a'), password: 'pw123456', inviteCode: c.code })).status).toBe(200);
    const second = uniq('b');
    const res = await register({ username: second, password: 'pw123456', inviteCode: c.code });
    expect(res.status).toBe(400);
    expect(await userRow(second)).toBeUndefined();
  });

  it('不存在的码 → 400，不建账号', async () => {
    logout();
    const username = uniq('x');
    expect((await register({ username, password: 'pw123456', inviteCode: 'no-such-code-0123456789' })).status).toBe(400);
    expect(await userRow(username)).toBeUndefined();
  });

  it('邀请码前后带空格 → 去掉空格后照常可用', async () => {
    const c = await newCode(await makeUser());
    logout();
    const username = uniq('trim');
    expect((await register({ username, password: 'pw123456', inviteCode: `  ${c.code}\n` })).status).toBe(200);
    expect(await userRow(username)).toBeDefined();
  });

  it('邀请码只有空格 → 当作没填邀请码，走开放注册(验证码失败就 400，验证码通过就建 open 档账号)', async () => {
    logout();
    vi.spyOn(captchaApi, 'verify').mockReturnValue(false);
    expect((await register({ username: uniq('ws'), password: 'pw123456', inviteCode: '   ' })).status).toBe(400);
    vi.spyOn(captchaApi, 'verify').mockReturnValue(true);
    const ok = uniq('ws');
    expect((await register({ username: ok, password: 'pw123456', inviteCode: '   ', captchaToken: 't', captchaAnswer: '1' })).status).toBe(200);
    expect((await userRow(ok)).scan_tier).toBe('open');
  });

  it('真正的验证码缺失/错误(不 mock)→ 开放注册被拒', async () => {
    logout();
    const username = uniq('nocap');
    expect((await register({ username, password: 'pw123456' })).status).toBe(400);
    expect((await register({ username, password: 'pw123456', captchaToken: 'garbage', captchaAnswer: '1' })).status).toBe(400);
    expect(await userRow(username)).toBeUndefined();
  });

  it('邀请码路径下，请求体里的 scanTier / signupSource / isAdmin / familyId 同样被忽略', async () => {
    const c = await newCode(await makeUser());
    logout();
    const username = uniq('inj');
    const res = await register({ username, password: 'pw123456', inviteCode: c.code, scanTier: 'open', signupSource: 'open', isAdmin: true, familyId: 1, invitedBy: 1 });
    expect(res.status).toBe(200);
    const u = await userRow(username);
    expect(u).toMatchObject({ scan_tier: 'normal', signup_source: 'invite', is_admin: 0, family_id: null });
    expect(u.invited_by).not.toBe(1 + 99999);
  });

  it('已过期的码 → 400', async () => {
    const c = await newCode(await makeUser());
    await dbApi.pool.execute('UPDATE invite_codes SET expires_at = NOW() - INTERVAL 1 SECOND WHERE id = ?', [c.id]);
    logout();
    expect((await register({ username: uniq('x'), password: 'pw123456', inviteCode: c.code })).status).toBe(400);
  });

  it('已作废的码 → 400', async () => {
    const c = await newCode(await makeUser());
    await dbApi.pool.execute('UPDATE invite_codes SET revoked_at = NOW() WHERE id = ?', [c.id]);
    logout();
    expect((await register({ username: uniq('x'), password: 'pw123456', inviteCode: c.code })).status).toBe(400);
  });

  it('三种无效原因返回同样的错误信息(不泄露码的状态)', async () => {
    const used = await newCode(await makeUser());
    logout();
    await register({ username: uniq('u'), password: 'pw123456', inviteCode: used.code });
    const expired = await newCode(await makeUser());
    await dbApi.pool.execute('UPDATE invite_codes SET expires_at = NOW() - INTERVAL 1 SECOND WHERE id = ?', [expired.id]);
    logout();
    const revoked = await newCode(await makeUser());
    await dbApi.pool.execute('UPDATE invite_codes SET revoked_at = NOW() WHERE id = ?', [revoked.id]);
    logout();
    const msgs = new Set();
    for (const code of [used.code, expired.code, revoked.code, 'nope-nope-nope-nope-nope']) {
      const res = await register({ username: uniq('x'), password: 'pw123456', inviteCode: code });
      expect(res.status).toBe(400);
      msgs.add((await res.json()).error);
    }
    expect(msgs.size).toBe(1);
  });

  it('用户名已存在 → 400，且邀请码不被消耗', async () => {
    const c = await newCode(await makeUser());
    const taken = await makeUser();
    logout();
    expect((await register({ username: taken.username, password: 'pw123456', inviteCode: c.code })).status).toBe(400);
    const [[code]] = await dbApi.pool.query('SELECT used_by FROM invite_codes WHERE id = ?', [c.id]);
    expect(code.used_by).toBeNull();
    // 码还能用
    expect((await register({ username: uniq('ok'), password: 'pw123456', inviteCode: c.code })).status).toBe(200);
  });

  it('并发: 同一个码同时被 8 个人注册 → 恰好 1 个成功，其余 400，只多出 1 个账号', async () => {
    const c = await newCode(await makeUser());
    logout();
    const names = Array.from({ length: 8 }, () => uniq('race'));
    const results = await Promise.all(names.map((username) => register({ username, password: 'pw123456', inviteCode: c.code })));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 400)).toHaveLength(7);
    const [rows] = await dbApi.pool.query('SELECT username FROM users WHERE username IN (?)', [names]);
    expect(rows).toHaveLength(1);
  });

  it('注册请求体里的 inviteCode 不是字符串(数组/对象)→ 400，不是 500', async () => {
    logout();
    for (const inviteCode of [['x'], { a: 1 }, 123]) {
      expect((await register({ username: uniq('x'), password: 'pw123456', inviteCode })).status).toBe(400);
    }
  });
});

describe('家庭邀请码注册', () => {
  it('注册后直接加入该家庭(account_type=family)，不需要审批', async () => {
    const creator = await makeUser();
    const familyId = await makeFamily(creator);
    const c = await newCode(creator, true);
    logout();
    const username = uniq('fam');
    const res = await register({ username, password: 'pw123456', inviteCode: c.code });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.familyId).toBe(familyId);
    expect(body.pendingFamilyRequest).toBe(false);
    const u = await userRow(username);
    expect(u.family_id).toBe(familyId);
    expect(u.account_type).toBe('family');
    expect(u.signup_source).toBe('invite');
  });

  it('家庭码 + 注册表单里另填了"创建新家庭" → 以家庭码为准，不再另建家庭', async () => {
    const creator = await makeUser();
    const familyId = await makeFamily(creator);
    const c = await newCode(creator, true);
    logout();
    const username = uniq('fam');
    const res = await register({ username, password: 'pw123456', inviteCode: c.code, accountType: 'family', familyAction: 'create', familyName: uniq('other') });
    expect(res.status).toBe(200);
    expect((await userRow(username)).family_id).toBe(familyId);
  });

  it('普通码 + 注册表单里选"创建新家庭" → 仍按表单创建家庭(普通码只管注册)', async () => {
    const c = await newCode(await makeUser());
    logout();
    const username = uniq('nf');
    const famName = uniq('newfam');
    const res = await register({ username, password: 'pw123456', inviteCode: c.code, accountType: 'family', familyAction: 'create', familyName: famName });
    expect(res.status).toBe(200);
    expect((await res.json()).isFamilyCreator).toBe(true);
    expect((await dbApi.findFamilyByName(famName)).creator_id).toBe((await userRow(username)).id);
  });

  it('家庭码对应的家庭被删除 → 外键级联删掉这个码，注册 400，不会建出没有家庭的账号', async () => {
    const creator = await makeUser();
    const familyId = await makeFamily(creator);
    const c = await newCode(creator, true);
    await dbApi.pool.execute('DELETE FROM families WHERE id = ?', [familyId]);
    logout();
    const username = uniq('x');
    expect((await register({ username, password: 'pw123456', inviteCode: c.code })).status).toBe(400);
    expect(await userRow(username)).toBeUndefined();
  });
});
