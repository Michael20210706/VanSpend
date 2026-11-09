import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import dbApi from '@/src/db.cjs';
import { getSession } from '@/src/session';
import { wrap, clientIp, readJson, FORM_BODY_MAX } from '@/src/http';

// 同一用户名或同一 IP 在 LOCK_MINUTES 内失败 MAX_FAILURES 次，即从凑满那一刻起锁定 LOCK_MINUTES 分钟
const MAX_FAILURES = 10;
const LOCK_MINUTES = 15;

const tooMany = () =>
  NextResponse.json({ error: `登录失败次数过多，请 ${LOCK_MINUTES} 分钟后再试` }, { status: 429 });

export const POST = wrap(async (request) => {
  const body = await readJson(request, FORM_BODY_MAX);
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const ip = clientIp(request); // 取不到时为 null，此时只按用户名限制

  // 1) 锁定期间直接拒绝(密码正确也拒绝，且不透露用户名是否存在)，不写记录
  if (await dbApi.isLoginLocked(username, ip, MAX_FAILURES, LOCK_MINUTES)) return tooMany();

  // 2) 先记一次尝试、再数、最后才校验密码: 并发到达的请求都能看到彼此已写入的记录，
  //    超过阈值的直接拒绝并撤回自己那条，保证每个窗口真正进入 bcrypt 的次数不超过 MAX_FAILURES。
  //    (先数后记的话，同时到达的一批请求都会读到 0，每个都能猜一次密码)
  const attemptId = await dbApi.recordLoginFailure(username, ip);
  const { byUser, byIp } = await dbApi.countRecentLoginFailures(username, ip, LOCK_MINUTES);
  if (byUser > MAX_FAILURES || byIp > MAX_FAILURES) {
    await dbApi.deleteLoginAttempt(attemptId);
    return tooMany();
  }

  // 3) 校验密码。失败就保留刚才的记录；成功则清掉该用户名的所有失败记录(含这一条)
  const user = username ? await dbApi.findUserByUsername(username) : null;
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 });
  }
  await dbApi.clearLoginFailures(username);

  const family = user.family_id ? await dbApi.findFamilyById(user.family_id) : null;

  const session = await getSession();
  session.userId = user.id;
  session.username = user.username;
  session.isAdmin = !!user.is_admin;
  session.familyId = family ? family.id : undefined;
  session.familyName = family ? family.name : undefined;
  session.familyRole = user.family_role || undefined;
  session.accountType = user.account_type;
  session.isFamilyCreator = family ? family.creator_id === user.id : false;
  await session.save();
  return NextResponse.json({
    id: user.id, username: user.username, isAdmin: session.isAdmin,
    familyId: session.familyId || null, familyName: session.familyName || null,
    familyRole: session.familyRole || null, accountType: session.accountType,
    isFamilyCreator: session.isFamilyCreator,
  });
});
