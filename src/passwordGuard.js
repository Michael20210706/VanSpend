import bcrypt from 'bcryptjs';
import dbApi from '@/src/db.cjs';

// 已登录状态下"再输一次密码确认"的接口(修改密码、注销账号)的防爆破。
// 拿到别人会话 cookie 的人可以在这些接口上无限次猜密码——之前没有任何限制。机制与登录防爆破相同，
// 但计数存在专用的 pw_failures 表、按已认证的 user_id 记，而不是复用 login_failures: 后者存的是登录框里任意输入的字符串，
// 用伪造的"用户名"就能去烧别人的计数(锁住受害者)或清零(靠登录成功触发 clearLoginFailures，绕过限速)。
// 修改密码和注销账号共用同一个计数，攻击者不能在两个接口之间各猜一半；只锁这个账号的这两个接口，不影响登录、不影响别人。
// 顺序与登录一致: 先查锁定 → 先记一笔 → 再数 → 超限撤销自己并拒绝 → 最后才 bcrypt，所以并发的一批请求也不会各自多猜。
export const PW_MAX_FAILURES = 10;
export const PW_LOCK_MINUTES = 15;

// 返回 'ok' | 'wrong' | 'locked'
export async function checkPasswordLimited(userId, password, passwordHash) {
  if (await dbApi.isPasswordLocked(userId, PW_MAX_FAILURES, PW_LOCK_MINUTES)) return 'locked';
  let attemptId;
  try {
    attemptId = await dbApi.recordPasswordFailure(userId);
  } catch (e) {
    // 请求处理期间这个账号刚好被删了(外键找不到用户): 当作密码错误，而不是 500
    if (e && e.code === 'ER_NO_REFERENCED_ROW_2') return 'wrong';
    throw e;
  }
  if ((await dbApi.countPasswordFailures(userId, PW_LOCK_MINUTES)) > PW_MAX_FAILURES) {
    await dbApi.deletePasswordFailure(attemptId);
    return 'locked';
  }
  if (!(await bcrypt.compare(password, passwordHash))) return 'wrong'; // 失败保留刚才那条记录
  await dbApi.clearPasswordFailures(userId);
  return 'ok';
}

export const lockedBody = () => ({ error: `密码错误次数过多，请 ${PW_LOCK_MINUTES} 分钟后再试` });
