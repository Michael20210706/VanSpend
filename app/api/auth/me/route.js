import { NextResponse } from 'next/server';
import { getAuthedSession } from '@/src/session';
import { wrap } from '@/src/http';

// 返回库里的最新身份(getAuthedSession 已用 users/families 刷新过)，不是登录时缓存在 cookie 里的旧值
export const GET = wrap(async () => {
  const session = await getAuthedSession();
  if (!session) return NextResponse.json({ error: '未登录' }, { status: 401 });
  return NextResponse.json({
    id: session.userId, username: session.username, isAdmin: !!session.isAdmin,
    familyId: session.familyId || null, familyName: session.familyName || null,
    familyRole: session.familyRole || null, accountType: session.accountType || 'individual',
    isFamilyCreator: !!session.isFamilyCreator,
  });
});
