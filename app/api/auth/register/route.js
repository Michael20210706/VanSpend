import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import dbApi from '@/src/db.cjs';
import captchaApi from '@/src/captcha.cjs';
import { getSession } from '@/src/session';
import { wrap } from '@/src/http';

const FAMILY_ROLES = ['dad', 'mom', 'child', 'other'];

export const POST = wrap(async (request) => {
  const body = await request.json();
  const username = (body.username || '').trim();
  const password = body.password || '';
  const familyRole = FAMILY_ROLES.includes(body.familyRole) ? body.familyRole : null;
  const accountType = body.accountType === 'family' ? 'family' : 'individual';
  const familyAction = body.familyAction === 'apply' ? 'apply' : 'create';
  const familyName = (body.familyName || '').trim();

  if (!username || !password) return NextResponse.json({ error: '用户名和密码不能为空' }, { status: 400 });
  if (!captchaApi.verify(body.captchaToken, body.captchaAnswer)) {
    return NextResponse.json({ error: '验证码错误或已过期，请重新验证' }, { status: 400 });
  }
  if (await dbApi.findUserByUsername(username)) return NextResponse.json({ error: '用户名已存在' }, { status: 400 });

  // 家庭相关校验放在建号前，避免"账号建了、家庭名却不合法"的半成功状态
  let existingFamily = null;
  if (accountType === 'family') {
    if (!familyName) return NextResponse.json({ error: '请填写家庭名称' }, { status: 400 });
    existingFamily = await dbApi.findFamilyByName(familyName);
    if (familyAction === 'create' && existingFamily) {
      return NextResponse.json({ error: '该家庭名称已被使用，换一个名称，或选择"申请加入"' }, { status: 400 });
    }
    if (familyAction === 'apply' && !existingFamily) {
      return NextResponse.json({ error: '未找到该家庭，请确认名称是否正确' }, { status: 400 });
    }
  }

  const isFirstUser = (await dbApi.countUsers()) === 0;
  const passwordHash = await bcrypt.hash(password, 10);
  const id = await dbApi.createUser(username, passwordHash, { familyRole });
  if (isFirstUser) await dbApi.backfillOwnerlessReceipts(id); // 迁移: 功能上线前的旧数据归给首个账号

  // 创建家庭立即生效；申请加入需等创建者审核，账号先以个人身份使用
  let familyId = null;
  let familyDisplayName = null;
  let isFamilyCreator = false;
  let pendingFamilyRequest = false;
  if (accountType === 'family' && familyAction === 'create') {
    familyId = await dbApi.createFamily(familyName, id);
    familyDisplayName = familyName;
    isFamilyCreator = true;
  } else if (accountType === 'family' && familyAction === 'apply') {
    await dbApi.applyToFamily(existingFamily.id, id);
    pendingFamilyRequest = true;
  }

  const session = await getSession();
  session.userId = id;
  session.username = username;
  session.isAdmin = false; // 自助注册永远不能是管理员，只能通过 ADMIN_USERNAME/ADMIN_PASSWORD 启动时初始化
  session.familyId = familyId || undefined;
  session.familyName = familyDisplayName || undefined;
  session.familyRole = familyRole || undefined;
  session.accountType = familyId ? 'family' : 'individual';
  session.isFamilyCreator = isFamilyCreator;
  await session.save();
  return NextResponse.json({
    id, username, isAdmin: false,
    familyId: familyId || null, familyName: familyDisplayName, isFamilyCreator,
    accountType: session.accountType, pendingFamilyRequest,
  });
});
