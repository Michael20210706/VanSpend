import { NextResponse } from 'next/server';
import dbApi from '@/src/db.cjs';
import { requireSession } from '@/src/session';
import { wrap } from '@/src/http';

// 成员自己退出家庭: 变回个人账号，自己的小票和明细摘掉家庭归属(跟人走)。
// 创建者还有其他成员时不能直接退出，要先转让创建者身份；创建者独自一人时退出 = 解散家庭。
export const POST = wrap(async () => {
  const { session, response } = await requireSession();
  if (response) return response;

  const result = await dbApi.leaveFamily(session.userId);
  if (result === 'not_in_family') return NextResponse.json({ error: '您目前不在任何家庭中' }, { status: 400 });
  if (result === 'creator_must_transfer') {
    return NextResponse.json({ error: '您是这个家庭的创建者，请先把创建者身份转让给其他成员，再退出' }, { status: 400 });
  }
  return NextResponse.json({ left: true, dissolved: result === 'dissolved' });
});
