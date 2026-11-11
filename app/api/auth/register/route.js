import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import dbApi from '@/src/db.cjs';
import captchaApi from '@/src/captcha.cjs';
import { getSession } from '@/src/session';
import { wrap, readJson, readString, clientIp, PASSWORD_MAX_BYTES, FORM_BODY_MAX } from '@/src/http';

const FAMILY_ROLES = ['dad', 'mom', 'child', 'other'];

// 不区分"不存在 / 已用 / 已作废 / 已过期"，统一一句话，免得被用来探测码的状态
const INVALID_CODE = () => NextResponse.json({ error: '邀请码无效、已被使用或已过期' }, { status: 400 });
const USERNAME_TAKEN = () => NextResponse.json({ error: '用户名已存在' }, { status: 400 });

// 两条注册路径并存:
//   带邀请码: 码本身就是"人"的证明，不再要验证码；账号按"邀请注册、正常额度"建，记录邀请人；
//            家庭码(创建者生成)注册后直接加入该家庭，表单里的家庭字段被忽略。
//   无邀请码(开放注册): 必须过验证码；账号标记为"开放注册"，落在低额度档(config.json scanQuota.open)，管理员可升级。
// signupSource / scanTier / isAdmin 永远由服务端按路径决定，请求体里同名字段一律忽略。
export const POST = wrap(async (request) => {
  const body = await readJson(request, FORM_BODY_MAX);
  // 所有字段的类型和长度都在消耗邀请码/验证码/IP 名额之前校验: 超长或非字符串直接 400，不消耗任何东西
  const username = readString(body, 'username', { label: '用户名', max: 100, noControl: true }); // users.username 列宽
  const password = readString(body, 'password', { label: '密码', trim: false, maxBytes: PASSWORD_MAX_BYTES });
  const familyRole = FAMILY_ROLES.includes(body.familyRole) ? body.familyRole : null;
  const accountType = body.accountType === 'family' ? 'family' : 'individual';
  const familyAction = body.familyAction === 'apply' ? 'apply' : 'create';
  const familyName = readString(body, 'familyName', { label: '家庭名称', max: 100 });

  // inviteCode 没填(缺省/null/空串/只有空格)= 开放注册；填了就必须是字符串，数组、对象、数字一律当无效码
  const rawCode = body.inviteCode;
  if (rawCode !== undefined && rawCode !== null && typeof rawCode !== 'string') return INVALID_CODE();
  const inviteCode = typeof rawCode === 'string' ? rawCode.trim() : '';
  const hasCode = inviteCode !== '';

  if (!username || !password) return NextResponse.json({ error: '用户名和密码不能为空' }, { status: 400 });

  // 邀请码预检(只读)。建号前就要知道是不是家庭码——家庭码会忽略表单里的家庭字段
  let peek = null;
  if (hasCode) {
    peek = await dbApi.peekInviteCode(inviteCode);
    if (!peek) return INVALID_CODE();
  } else {
    const BAD_CAPTCHA = () => NextResponse.json({ error: '验证码错误或已过期，请重新验证' }, { status: 400 });
    const answerOk = captchaApi.verify(body.captchaToken, body.captchaAnswer);
    // 一次性: 同一个验证码 token 只能用一次(此前 5 分钟内可无限重放)。答案对、或者 token 签名有效但答案错，都算用掉——
    // 否则一位数加减只有约 27 种答案，同一个 token 可以反复猜。不管后面成不成功都得重新出题；签名无效的垃圾 token 不入库
    if (answerOk || captchaApi.isWellFormed(body.captchaToken)) {
      if (!(await dbApi.consumeCaptcha(captchaApi.tokenKey(body.captchaToken)))) return BAD_CAPTCHA();
    }
    if (!answerOk) return BAD_CAPTCHA();
    // 限速: 过了验证码的开放注册尝试，每个 IP 滚动 24 小时有上限，全站另有总量上限(config openRegistration)。取不到 IP 时只受总量限制
    const verdict = await dbApi.reserveOpenSignup(clientIp(request));
    if (verdict === 'ip_limit') {
      return NextResponse.json({ error: '这个网络今天的注册尝试次数过多，请明天再试，或使用邀请码注册' }, { status: 429 });
    }
    if (verdict === 'global_limit') {
      return NextResponse.json({ error: '今天的开放注册名额已满，请明天再试，或使用邀请码注册' }, { status: 429 });
    }
  }
  if (await dbApi.findUserByUsername(username)) return USERNAME_TAKEN();

  // 表单里的家庭选项只在"没用家庭码"时生效
  const formFamily = accountType === 'family' && !(peek && peek.family_id);

  // 家庭相关校验放在建号前，避免"账号建了、家庭名却不合法"的半成功状态
  let existingFamily = null;
  if (formFamily) {
    if (!familyName) return NextResponse.json({ error: '请填写家庭名称' }, { status: 400 });
    existingFamily = await dbApi.findFamilyByName(familyName);
    if (familyAction === 'create' && existingFamily) {
      return NextResponse.json({ error: '该家庭名称已被使用，换一个名称，或选择"申请加入"' }, { status: 400 });
    }
    if (familyAction === 'apply' && !existingFamily) {
      return NextResponse.json({ error: '未找到该家庭，请确认名称是否正确' }, { status: 400 });
    }
  }

  const passwordHash = await bcrypt.hash(password, 10);
  let id;
  let familyId = null;
  let familyDisplayName = null;
  let isFamilyCreator = false;
  let pendingFamilyRequest = false;

  if (hasCode) {
    // 建号 + 消耗邀请码(+ 家庭码入家庭)在一个事务里；并发用同一个码，只有一个能成功
    let created;
    try {
      created = await dbApi.registerWithInvite(inviteCode, username, passwordHash, { familyRole });
    } catch (e) {
      if (e && e.code === 'ER_DUP_ENTRY') return USERNAME_TAKEN();
      throw e;
    }
    if (!created) return INVALID_CODE();
    id = created.id;
    familyId = created.familyId;
    familyDisplayName = created.familyName;
  } else {
    const isFirstUser = (await dbApi.countUsers()) === 0;
    try {
      id = await dbApi.createUser(username, passwordHash, { familyRole, signupSource: 'open' });
    } catch (e) {
      if (e && e.code === 'ER_DUP_ENTRY') return USERNAME_TAKEN();
      throw e;
    }
    if (isFirstUser) await dbApi.backfillOwnerlessReceipts(id); // 迁移: 功能上线前的旧数据归给首个账号
  }

  // 创建家庭立即生效；申请加入需等创建者审核，账号先以个人身份使用
  if (formFamily && familyAction === 'create') {
    familyId = await dbApi.createFamily(familyName, id);
    familyDisplayName = familyName;
    isFamilyCreator = true;
  } else if (formFamily && familyAction === 'apply') {
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
