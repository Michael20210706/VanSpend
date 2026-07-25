import { NextResponse } from 'next/server';
import dbApi from '@/src/db.cjs';
import { requireSession } from '@/src/session';
import { wrap } from '@/src/http';

// 个人账号事后创建家庭(注册时选"个人"的用户，后来想建家庭也走这里，和注册时创建家庭是同一套逻辑)
export const POST = wrap(async (request) => {
  const { session, response } = await requireSession();
  if (response) return response;
  if (session.familyId) return NextResponse.json({ error: '您已经在一个家庭中' }, { status: 400 });

  const body = await request.json();
  const name = (body.name || '').trim();
  if (!name) return NextResponse.json({ error: '请填写家庭名称' }, { status: 400 });
  if (await dbApi.findFamilyByName(name)) {
    return NextResponse.json({ error: '该家庭名称已被使用，换一个名称，或选择"申请加入"' }, { status: 400 });
  }

  const familyId = await dbApi.createFamily(name, session.userId);

  session.familyId = familyId;
  session.familyName = name;
  session.accountType = 'family';
  session.isFamilyCreator = true;
  await session.save();
  return NextResponse.json({ familyId, familyName: name, isFamilyCreator: true, accountType: 'family' });
});
