import { NextResponse } from 'next/server';
import dbApi from '@/src/db.cjs';
import { requireSession, requireFamilyCreator } from '@/src/session';
import { wrap, readJson, readString, FORM_BODY_MAX } from '@/src/http';

const FAMILY_NAME_MAX = 100; // families.name 列宽

// 个人账号事后创建家庭(注册时选"个人"的用户，后来想建家庭也走这里，和注册时创建家庭是同一套逻辑)
export const POST = wrap(async (request) => {
  const { session, response } = await requireSession();
  if (response) return response;
  if (session.familyId) return NextResponse.json({ error: '您已经在一个家庭中' }, { status: 400 });

  const body = await readJson(request, FORM_BODY_MAX);
  const name = readString(body, 'name', { label: '家庭名称', required: true, max: FAMILY_NAME_MAX });
  if (await dbApi.findFamilyByName(name)) {
    return NextResponse.json({ error: '该家庭名称已被使用，换一个名称，或选择"申请加入"' }, { status: 400 });
  }

  const familyId = await dbApi.createFamily(name, session.userId);
  if (familyId === null) return NextResponse.json({ error: '您已经在一个家庭中' }, { status: 400 });

  session.familyId = familyId;
  session.familyName = name;
  session.accountType = 'family';
  session.isFamilyCreator = true;
  await session.save();
  return NextResponse.json({ familyId, familyName: name, isFamilyCreator: true, accountType: 'family' });
});

// 创建者改家庭名: body { name }，去掉首尾空格，1 到 100 个字符，全站唯一；历史小票里冗余的家庭名一并更新
export const PATCH = wrap(async (request) => {
  const { session, response } = await requireFamilyCreator();
  if (response) return response;

  const body = await readJson(request, FORM_BODY_MAX);
  const name = readString(body, 'name', { label: '家庭名称', required: true, max: FAMILY_NAME_MAX });

  const result = await dbApi.renameFamily(session.familyId, session.userId, name);
  if (result === 'forbidden') return NextResponse.json({ error: '无权限' }, { status: 403 });
  if (result === 'name_taken') return NextResponse.json({ error: '该家庭名称已被使用，换一个名称' }, { status: 400 });
  return NextResponse.json({ renamed: true, name });
});
