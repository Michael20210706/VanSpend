import { NextResponse } from 'next/server';
import { checkPasswordLimited, lockedBody } from '@/src/passwordGuard';
import dbApi from '@/src/db.cjs';
import uploadsLib from '@/src/uploads.cjs';
import { requireSession, getSession } from '@/src/session';
import { wrap, readJson, FORM_BODY_MAX } from '@/src/http';

// 自助注销账号: 输入当前密码确认。连带删除小票、明细(外键级联)和原图文件。
// 家庭创建者须先转让创建者身份或解散家庭(400，不替用户做这个决定)；管理员账号不能自助注销(来自 .env 引导，403)。
// 路径在 /api/auth/ 下: 密码错误的 401 是"表单填错"，不会触发前端的"会话过期"弹回登录。
export const POST = wrap(async (request) => {
  const { session, response } = await requireSession();
  if (response) return response;

  const body = await readJson(request, FORM_BODY_MAX);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password) return NextResponse.json({ error: '请输入密码确认注销' }, { status: 400 });
  if (session.isAdmin) return NextResponse.json({ error: '管理员账号不能自助注销' }, { status: 403 });

  const user = await dbApi.findUserById(session.userId);
  if (!user) return NextResponse.json({ error: '密码不正确' }, { status: 401 });
  // 带防爆破: 与修改密码共用一个失败计数(10 次 / 15 分钟，见 src/passwordGuard.js)
  const check = await checkPasswordLimited(user.id, password, user.password_hash);
  if (check === 'locked') return NextResponse.json(lockedBody(), { status: 429 });
  if (check !== 'ok') return NextResponse.json({ error: '密码不正确' }, { status: 401 });

  const { status, images } = await dbApi.deleteOwnAccount(session.userId);
  if (status === 'creator') {
    return NextResponse.json({ error: '你是家庭创建者：请先在「家庭」页转让创建者身份，或解散家庭，再注销账号' }, { status: 400 });
  }
  if (status === 'is_admin') return NextResponse.json({ error: '管理员账号不能自助注销' }, { status: 403 });
  if (status === 'not_found') return NextResponse.json({ error: '账号不存在' }, { status: 404 });

  uploadsLib.deleteImages(images); // 数据库已提交，再删原图文件
  (await getSession()).destroy();
  return NextResponse.json({ ok: true });
});
