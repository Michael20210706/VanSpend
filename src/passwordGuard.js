import bcrypt from 'bcryptjs';
import dbApi from '@/src/db.cjs';

// 已登录状态下"再输一次密码确认"的接口(修改密码、注销账号)的防爆破。
// 拿到别人会话 cookie 的人可以在这些接口上无限次猜密码——之前没有任何限制。这里复用登录防爆破的同一套机制和表(login_failures)，
// 但用独立的键 `pw:<用户id>` 且不带 IP: 只锁这个账号的这两个接口，不影响它登录，也不影响同一 IP 上的其他人。
// 修改密码和注销账号共用同一个计数，攻击者不能在两个接口之间各猜一半。
// 顺序与登录一致: 先查锁定 → 先记一笔 → 再数 → 超限撤销自己并拒绝 → 最后才 bcrypt，所以并发的一批请求也不会各自多猜。
export const PW_MAX_FAILURES = 10;
export const PW_LOCK_MINUTES = 15;

// 返回 'ok' | 'wrong' | 'locked'
export async function checkPasswordLimited(userId, password, passwordHash) {
  const key = `pw:${userId}`;
  if (await dbApi.isLoginLocked(key, null, PW_MAX_FAILURES, PW_LOCK_MINUTES)) return 'locked';
  const attemptId = await dbApi.recordLoginFailure(key, null);
  const { byUser } = await dbApi.countRecentLoginFailures(key, null, PW_LOCK_MINUTES);
  if (byUser > PW_MAX_FAILURES) {
    await dbApi.deleteLoginAttempt(attemptId);
    return 'locked';
  }
  if (!(await bcrypt.compare(password, passwordHash))) return 'wrong'; // 失败保留刚才那条记录
  await dbApi.clearLoginFailures(key);
  return 'ok';
}

export const lockedBody = () => ({ error: `密码错误次数过多，请 ${PW_LOCK_MINUTES} 分钟后再试` });
