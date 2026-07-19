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

// session.userId / session.username 由 auth 路由写入；未登录时两者均为 undefined
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
