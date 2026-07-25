import { cookies } from 'next/headers';
import { getIronSession } from 'iron-session';
import { NextResponse } from 'next/server';
import crypto from 'crypto';

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
    secure: false, // 应用本身仅监听 localhost，无 TLS 终结在这一层
    maxAge: 30 * 24 * 60 * 60, // 30 天(单位: 秒)
  },
};

// session.userId / session.username / session.isAdmin / session.familyId / session.familyName /
// session.familyRole / session.accountType / session.isFamilyCreator 由 auth 路由写入；未登录时均为 undefined。
// 家庭字段和 isAdmin 一样只在登录/注册时写入一次: 之后创建家庭/被邀请/审核通过都不会实时刷新已登录会话的 cookie，
// 要等下次重新登录才生效(与 isAdmin 撤权的滞后性同理)。
export async function getSession() {
  return getIronSession(await cookies(), sessionOptions);
}

// 路由处理器里鉴权的公共写法: const { session, response } = await requireSession(); if (response) return response;
export async function requireSession() {
  const session = await getSession();
  if (!session.userId) {
    return { session: null, response: NextResponse.json({ error: '未登录' }, { status: 401 }) };
  }
  return { session, response: null };
}

// 管理后台路由用: 未登录 401，登录了但不是管理员 403
export async function requireAdmin() {
  const session = await getSession();
  if (!session.userId) {
    return { session: null, response: NextResponse.json({ error: '未登录' }, { status: 401 }) };
  }
  if (!session.isAdmin) {
    return { session: null, response: NextResponse.json({ error: '无权限' }, { status: 403 }) };
  }
  return { session, response: null };
}

// 家庭管理路由(邀请/审核申请)用: 未登录 401，登录了但不是本家庭创建者 403
export async function requireFamilyCreator() {
  const session = await getSession();
  if (!session.userId) {
    return { session: null, response: NextResponse.json({ error: '未登录' }, { status: 401 }) };
  }
  if (!session.familyId || !session.isFamilyCreator) {
    return { session: null, response: NextResponse.json({ error: '无权限' }, { status: 403 }) };
  }
  return { session, response: null };
}
