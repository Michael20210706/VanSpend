// 此前文档里记录的"已知并发缺口"(偶发死锁 500、批准申请的创建者复核、申请人已入别的家庭仍报成功、保存与注销撞车留下孤儿图片等)
import fs from 'fs';
import { describe, it, expect, vi, afterEach } from 'vitest';
import dbApi from '@/src/db.cjs';
import { checkPasswordLimited } from '@/src/passwordGuard';
import * as decideRoute from '@/app/api/family/requests/[id]/route.js';
import * as receiptsRoute from '@/app/api/receipts/route.js';
import * as passwordRoute from '@/app/api/auth/password/route.js';
import * as resetRoute from '@/app/api/admin/users/[id]/reset-password/route.js';
import { makeUser, makeFamily, loginAs, logout, req, ctx, uniq } from './helpers.js';

afterEach(() => vi.restoreAllMocks());

const famName = async (id) => (await dbApi.pool.query('SELECT name FROM families WHERE id = ?', [id]))[0][0].name;
const userRow = async (id) => (await dbApi.pool.query('SELECT * FROM users WHERE id = ?', [id]))[0][0];
const exists = async (id) => (await dbApi.pool.query('SELECT 1 FROM users WHERE id = ?', [id]))[0].length === 1;
const decide = (id, decision) => decideRoute.POST(req('/x', { method: 'POST', body: { decision } }), ctx({ id: String(id) }));
const ROUNDS = 12;

async function settledOk(promises) {
  const results = await Promise.allSettled(promises);
  for (const r of results) expect(r.status, r.reason && r.reason.message).toBe('fulfilled');
  return results.map((r) => r.value);
}

describe('此前会死锁返回 500 的并发组合，现在都不再抛错', () => {
  it('批准加入申请 vs 创建者解散家庭', async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const creator = await makeUser();
      const applicant = await makeUser();
      const familyId = await makeFamily(creator);
      const requestId = await dbApi.applyToFamily(familyId, applicant.id);
      const name = await famName(familyId);
      await settledOk([dbApi.decideRequest(requestId, familyId, true, creator.id), dbApi.dissolveFamily(familyId, creator.id, name)]);
      expect((await userRow(applicant.id)).family_id).toBeNull(); // 家庭没了，谁都不在里面
    }
  });

  it('按用户名邀请 vs 解散家庭', async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const creator = await makeUser();
      const invitee = await makeUser();
      const familyId = await makeFamily(creator);
      const name = await famName(familyId);
      await settledOk([dbApi.inviteMember(familyId, invitee.username), dbApi.dissolveFamily(familyId, creator.id, name)]);
      expect((await userRow(invitee.id)).family_id).toBeNull();
    }
  });

  it('家庭邀请码注册 vs 解散家庭: 要么拿到(随后被解散变回个人)，要么码已失效，不抛错', async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const creator = await makeUser();
      const familyId = await makeFamily(creator);
      const code = await dbApi.createInviteCode(creator.id, { familyId });
      const name = await famName(familyId);
      const username = uniq('fc');
      const [reg] = await settledOk([dbApi.registerWithInvite(code.code || code, username, 'hash'), dbApi.dissolveFamily(familyId, creator.id, name)]);
      if (reg) expect((await dbApi.findUserByUsername(username)).family_id).toBeNull();
    }
  });

  it('管理员删除家庭创建者 vs 成员退出 / 创建者转让给成员', async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const creator = await makeUser();
      const member = await makeUser();
      await makeFamily(creator, member);
      const familyId = (await userRow(creator.id)).family_id;
      await settledOk([
        dbApi.deleteUserFull(creator.id),
        i % 2 ? dbApi.leaveFamily(member.id) : dbApi.transferCreator(familyId, creator.id, member.id),
      ]);
      expect(await exists(creator.id)).toBe(false);
    }
  });

  it('改密码失败计数写入 vs 账号被删: 不 500(账号没了就当密码错误)', async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const u = await makeUser({ password: 'pw-guard-12345' });
      const hash = (await userRow(u.id)).password_hash;
      const [r] = await settledOk([checkPasswordLimited(u.id, 'wrong', hash), dbApi.deleteOwnAccount(u.id)]);
      expect(['wrong', 'locked', 'ok']).toContain(r);
    }
  });

  it('死锁重试: 注入一次死锁 → 自动重来并成功；连续 4 次 → 放弃并抛出原错误', async () => {
    const creator = await makeUser();
    const member = await makeUser();
    await makeFamily(creator, member);
    const real = dbApi.pool.getConnection.bind(dbApi.pool);
    let n = 0;
    vi.spyOn(dbApi.pool, 'getConnection').mockImplementation(async () => {
      if (n++ < 1) throw Object.assign(new Error('Deadlock found'), { code: 'ER_LOCK_DEADLOCK' });
      return real();
    });
    expect(await dbApi.leaveFamily(member.id)).toBe('left');
    expect(n).toBeGreaterThan(1); // 确实重试过

    const other = await makeUser();
    const fam2 = await makeFamily(other);
    const name2 = await famName(fam2);
    vi.restoreAllMocks();
    vi.spyOn(dbApi.pool, 'getConnection').mockImplementation(async () => {
      throw Object.assign(new Error('Deadlock found'), { code: 'ER_LOCK_DEADLOCK' });
    });
    await expect(dbApi.dissolveFamily(fam2, other.id, name2)).rejects.toMatchObject({ code: 'ER_LOCK_DEADLOCK' });
  });

  it('重试次数固定: 连续失败 3 次后第 4 次成功 → 成功；失败 4 次 → 抛出(共调用 4 次)', async () => {
    const creator = await makeUser();
    const member = await makeUser();
    await makeFamily(creator, member);
    const real = dbApi.pool.getConnection.bind(dbApi.pool);
    let n = 0;
    vi.spyOn(dbApi.pool, 'getConnection').mockImplementation(async () => {
      if (n++ < 3) throw Object.assign(new Error('Deadlock'), { code: 'ER_LOCK_DEADLOCK' });
      return real();
    });
    expect(await dbApi.leaveFamily(member.id)).toBe('left');
    vi.restoreAllMocks();
    const u = await makeUser();
    let calls = 0;
    vi.spyOn(dbApi.pool, 'getConnection').mockImplementation(async () => {
      calls++;
      throw Object.assign(new Error('Deadlock'), { code: 'ER_LOCK_DEADLOCK' });
    });
    await expect(dbApi.deleteOwnAccount(u.id)).rejects.toMatchObject({ code: 'ER_LOCK_DEADLOCK' });
    expect(calls).toBe(4);
  });

  it('不是死锁的错误不重试(只调用一次)', async () => {
    const u = await makeUser();
    let n = 0;
    vi.spyOn(dbApi.pool, 'getConnection').mockImplementation(async () => {
      n++;
      throw Object.assign(new Error('boom'), { code: 'ER_PARSE_ERROR' });
    });
    await expect(dbApi.deleteOwnAccount(u.id)).rejects.toMatchObject({ code: 'ER_PARSE_ERROR' });
    expect(n).toBe(1);
  });
});

describe('批准申请的复核', () => {
  it('刚转让走的原创建者再批准在途的申请 → 403，申请仍是待审，申请人没进家庭', async () => {
    const oldCreator = await makeUser();
    const newCreator = await makeUser();
    const applicant = await makeUser();
    const familyId = await makeFamily(oldCreator, newCreator);
    const requestId = await dbApi.applyToFamily(familyId, applicant.id);
    await dbApi.transferCreator(familyId, oldCreator.id, newCreator.id);
    expect(await dbApi.decideRequest(requestId, familyId, true, oldCreator.id)).toBe('forbidden');
    const [[r]] = await dbApi.pool.query('SELECT status FROM family_join_requests WHERE id = ?', [requestId]);
    expect(r.status).toBe('pending');
    expect((await userRow(applicant.id)).family_id).toBeNull();
    // 新创建者可以批准
    expect(await dbApi.decideRequest(requestId, familyId, true, newCreator.id)).toBe(true);
    expect((await userRow(applicant.id)).family_id).toBe(familyId);
  });

  it('申请人已经加入了别的家庭 → 批准返回 409 而不是假成功；这条申请收尾为 rejected，没有改动他的家庭', async () => {
    const creator = await makeUser();
    const otherCreator = await makeUser();
    const applicant = await makeUser();
    const familyId = await makeFamily(creator);
    const otherFamily = await makeFamily(otherCreator);
    const requestId = await dbApi.applyToFamily(familyId, applicant.id);
    await dbApi.inviteMember(otherFamily, applicant.username); // 申请人被另一个家庭邀请走了
    await loginAs(creator);
    const res = await decide(requestId, 'approve');
    expect(res.status).toBe(409);
    expect((await userRow(applicant.id)).family_id).toBe(otherFamily);
    const [[r]] = await dbApi.pool.query('SELECT status FROM family_join_requests WHERE id = ?', [requestId]);
    expect(r.status).toBe('rejected');
  });

  it('正常批准仍然 200 且申请人入家庭；拒绝仍然 200', async () => {
    const creator = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const familyId = await makeFamily(creator);
    const ra = await dbApi.applyToFamily(familyId, a.id);
    const rb = await dbApi.applyToFamily(familyId, b.id);
    await loginAs(creator);
    expect((await decide(ra, 'approve')).status).toBe(200);
    expect((await decide(rb, 'reject')).status).toBe(200);
    expect((await userRow(a.id)).family_id).toBe(familyId);
    expect((await userRow(b.id)).family_id).toBeNull();
    expect((await decide(ra, 'approve')).status).toBe(404); // 已处理
  });
});

describe('保存小票 vs 账号被注销', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const post = () => receiptsRoute.POST(req('/api/receipts', {
    method: 'POST',
    body: {
      receipt: { store: 'Race', purchased_at: '2026-06-01', currency: 'CAD', subtotal: 5, gst: 0, pst: 0, total: 5 },
      items: [{ name_raw: 'X', name_norm: 'x', category: '其他', qty: 1, unit_price: 5, amount: 5, taxable: 0 }],
      image: PNG,
    },
  }));

  it('账号已被删后保存 → 401(不是 500)，并且写到磁盘的原图被收回', async () => {
    const u = await makeUser();
    await loginAs(u);
    const before = fs.readdirSync(process.env.UPLOAD_DIR).length;
    // 让路由的会话检查通过、但保存时账号已不存在: 在 saveReceipt 之前删号
    const real = dbApi.saveReceipt;
    vi.spyOn(dbApi, 'saveReceipt').mockImplementation(async (...a) => {
      await dbApi.pool.execute('DELETE FROM users WHERE id = ?', [u.id]);
      return real(...a);
    });
    const res = await post();
    expect(res.status).toBe(401);
    expect(fs.readdirSync(process.env.UPLOAD_DIR).length).toBe(before);
  });

  it('并发: 保存与注销同时发生 → 只会是 200 或 401，不会 500，也不留孤儿图片', async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const u = await makeUser({ password: 'race-pass-123' });
      await loginAs(u);
      const before = fs.readdirSync(process.env.UPLOAD_DIR).length;
      const [res] = await settledOk([post(), dbApi.deleteOwnAccount(u.id).then(async (r) => {
        // 与路由一样: 事务提交后再删原图
        const up = await import('@/src/uploads.cjs');
        (up.default || up).deleteImages(r.images);
        return r;
      })]);
      expect([200, 401]).toContain(res.status);
      expect(fs.readdirSync(process.env.UPLOAD_DIR).length).toBe(before);
    }
  });
});

describe('管理员重置密码同时解除"输密码确认"的锁', () => {
  it('用户已被锁(10 次失败)→ 管理员重置 → 用临时密码改密码立即可用', async () => {
    const admin = await makeUser({ admin: true });
    const u = await makeUser({ password: 'old-pass-12345' });
    await dbApi.pool.query(`INSERT INTO pw_failures (user_id) VALUES ${Array(10).fill('(?)').join(',')}`, Array(10).fill(u.id));
    await loginAs(u);
    const locked = await passwordRoute.POST(req('/x', { method: 'POST', body: { currentPassword: 'old-pass-12345', newPassword: 'new-pass-12345' } }));
    expect(locked.status).toBe(429);
    await loginAs(admin);
    const { temporaryPassword } = await (await resetRoute.POST(req('/x', { method: 'POST' }), ctx({ id: String(u.id) }))).json();
    expect((await dbApi.pool.query('SELECT COUNT(*) n FROM pw_failures WHERE user_id = ?', [u.id]))[0][0].n).toBe(0);
    await loginAs(u);
    const ok = await passwordRoute.POST(req('/x', { method: 'POST', body: { currentPassword: temporaryPassword, newPassword: 'new-pass-12345' } }));
    expect(ok.status).toBe(200);
    logout();
  });
});

describe('先拿家庭行的共享锁(别人持有家庭行的排他锁时，这些操作会等待，而不是抢先去动用户/申请行)', () => {
  // 在另一个连接里对家庭行 SELECT ... FOR UPDATE 持锁 400ms 后提交；被测操作若按"先家庭行"的顺序，应在持锁期间一直等
  async function withFamilyLocked(familyId, run) {
    const conn = await dbApi.pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute('SELECT id FROM families WHERE id = ? FOR UPDATE', [familyId]);
      let done = false;
      const p = run().then((r) => { done = true; return r; });
      await new Promise((r) => setTimeout(r, 400));
      const waited = !done;
      await conn.commit();
      const result = await p;
      return { waited, result };
    } finally {
      conn.release();
    }
  }

  it('decideRequest 等家庭行', async () => {
    const creator = await makeUser();
    const applicant = await makeUser();
    const familyId = await makeFamily(creator);
    const requestId = await dbApi.applyToFamily(familyId, applicant.id);
    const { waited, result } = await withFamilyLocked(familyId, () => dbApi.decideRequest(requestId, familyId, true, creator.id));
    expect(waited).toBe(true);
    expect(result).toBe(true);
  });

  it('inviteMember 等家庭行', async () => {
    const creator = await makeUser();
    const invitee = await makeUser();
    const familyId = await makeFamily(creator);
    const { waited, result } = await withFamilyLocked(familyId, () => dbApi.inviteMember(familyId, invitee.username));
    expect(waited).toBe(true);
    expect(result).toBe(true);
  });

  it('家庭邀请码注册(registerWithInvite)等家庭行', async () => {
    const creator = await makeUser();
    const familyId = await makeFamily(creator);
    const code = await dbApi.createInviteCode(creator.id, { familyId });
    const { waited, result } = await withFamilyLocked(familyId, () => dbApi.registerWithInvite(code.code || code, uniq('fc'), 'hash'));
    expect(waited).toBe(true);
    expect(result).toBeTruthy();
  });

  it('对照: 个人邀请码(不属于任何家庭)的注册不会被家庭行的锁挡住', async () => {
    const creator = await makeUser();
    const other = await makeUser();
    const familyId = await makeFamily(other);
    const code = await dbApi.createInviteCode(creator.id);
    const { waited } = await withFamilyLocked(familyId, () => dbApi.registerWithInvite(code.code || code, uniq('pc'), 'hash'));
    expect(waited).toBe(false);
  });
});
