import { cookies } from 'next/headers';
import { getIronSession } from 'iron-session';
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import dbApi from '@/src/db.cjs';

if (!process.env.SESSION_SECRET) {
  console.warn('[session] 未设置 SESSION_SECRET，本次启动将使用随机密钥(重启后所有人需重新登录)，建议在 .env 中固定该值');
}
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

export const sessionOptions = {
  password: SECRET,
  cookieName: 'vanspend.sid',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'lax',
    // 公网部署(Cloudflare Tunnel，浏览器到边缘是 HTTPS)时在 .env 设 COOKIE_SECURE=true；
    // 本地 http://localhost 开发/试用保持 false，否则 Safari 等浏览器不会回传 cookie、无法登录
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: 30 * 24 * 60 * 60, // 30 天(单位: 秒)
  },
};

// cookie 里只有 userId 是可信的"身份"；isAdmin / familyId / familyName / familyRole / accountType / isFamilyCreator / scanTier
// 虽然登录时也会写进 cookie，但鉴权一律以数据库为准: getAuthedSession() 每个请求按 userId 查一次 users(+families)，
// 用库里的值覆盖这些字段(只改内存里的 session 对象，不回写 cookie)。所以撤销管理员、加入家庭(被邀请/申请通过)、删除账号
// 都在下一个请求立即生效，不必等 cookie 过期或重新登录。
export async function getSession() {
  return getIronSession(await cookies(), sessionOptions);
}

// 已登录且账号仍存在 → 返回已用库中最新值刷新过的 session；否则返回 null(账号已被删除时顺带清掉 cookie)
export async function getAuthedSession() {
  const session = await getSession();
  if (!session.userId) return null;
  const u = await dbApi.getSessionUser(session.userId);
  if (!u) {
    session.destroy();
    return null;
  }
  session.username = u.username;
  session.isAdmin = !!u.is_admin;
  session.familyId = u.family_id || undefined;
  session.familyName = u.family_name || undefined;
  session.familyRole = u.family_role || undefined;
  session.accountType = u.account_type || 'individual';
  session.scanTier = u.scan_tier || 'normal';
  session.isFamilyCreator = !!u.family_id && u.family_creator_id === u.id;
  return session;
}

// 路由处理器里鉴权的公共写法: const { session, response } = await requireSession(); if (response) return response;
export async function requireSession() {
  const session = await getAuthedSession();
  if (!session) {
    return { session: null, response: NextResponse.json({ error: '未登录' }, { status: 401 }) };
  }
  return { session, response: null };
}

// 管理后台路由用: 未登录 401，登录了但不是管理员 403
export async function requireAdmin() {
  const session = await getAuthedSession();
  if (!session) {
    return { session: null, response: NextResponse.json({ error: '未登录' }, { status: 401 }) };
  }
  if (!session.isAdmin) {
    return { session: null, response: NextResponse.json({ error: '无权限' }, { status: 403 }) };
  }
  return { session, response: null };
}

// 家庭管理路由(邀请/审核申请)用: 未登录 401，登录了但不是本家庭创建者 403
export async function requireFamilyCreator() {
  const session = await getAuthedSession();
  if (!session) {
    return { session: null, response: NextResponse.json({ error: '未登录' }, { status: 401 }) };
  }
  if (!session.familyId || !session.isFamilyCreator) {
    return { session: null, response: NextResponse.json({ error: '无权限' }, { status: 403 }) };
  }
  return { session, response: null };
}
