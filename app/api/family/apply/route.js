import { NextResponse } from 'next/server';
import dbApi from '@/src/db.cjs';
import { requireSession } from '@/src/session';
import { wrap } from '@/src/http';

// 申请加入已有家庭；不立即生效，需家庭创建者审核通过
export const POST = wrap(async (request) => {
  const { session, response } = await requireSession();
  if (response) return response;
  if (session.familyId) return NextResponse.json({ error: '您已经在一个家庭中' }, { status: 400 });

  const body = await request.json();
  const name = (body.name || '').trim();
  if (!name) return NextResponse.json({ error: '请填写要加入的家庭名称' }, { status: 400 });
  const family = await dbApi.findFamilyByName(name);
  if (!family) return NextResponse.json({ error: '未找到该家庭，请确认名称是否正确' }, { status: 400 });

  await dbApi.applyToFamily(family.id, session.userId);
  return NextResponse.json({ pending: true });
});
