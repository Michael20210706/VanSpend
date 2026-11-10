import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import dbApi from '@/src/db.cjs';
import { requireAdmin } from '@/src/session';
import { wrap, parseId } from '@/src/http';

// 去掉容易看错的字符(0/O、1/l/I)。12 位 × 约 5 bit ≈ 60 bit，够一次性临时密码用；用 crypto.randomInt，不用 Math.random
const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function tempPassword() {
  let s = '';
  for (let i = 0; i < 12; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return s;
}

// 管理员把某用户的密码重置成一个临时密码，用户下次登录必须先修改(在改掉之前，除改密码/退出外的接口全部 403)。
// 临时密码只在这次响应里返回一次(Cache-Control: no-store)，库里只有 bcrypt 哈希，操作日志里也不含它——管理员要自己转告用户。
// 不能重置自己(请用"修改密码")，也不能重置管理员账号(它的密码来自 .env 引导)。
export const POST = wrap(async (request, { params }) => {
  const { session, response } = await requireAdmin();
  if (response) return response;

  const id = parseId((await params).id);
  if (id === null) return NextResponse.json({ error: '无效的 id' }, { status: 400 });
  if (id === session.userId) return NextResponse.json({ error: '不能重置自己的密码，请使用"修改密码"' }, { status: 400 });

  const temp = tempPassword();
  const hash = await bcrypt.hash(temp, 10);
  const result = await dbApi.resetUserPassword(id, hash, { id: session.userId, username: session.username });
  if (result === 'not_found') return NextResponse.json({ error: '用户不存在' }, { status: 404 });
  if (result === 'is_admin') return NextResponse.json({ error: '不能重置管理员账号的密码' }, { status: 400 });
  return NextResponse.json({ id, temporaryPassword: temp }, { headers: { 'Cache-Control': 'no-store' } });
});
