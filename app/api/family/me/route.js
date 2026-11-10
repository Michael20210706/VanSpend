import { NextResponse } from 'next/server';
import dbApi from '@/src/db.cjs';
import { requireSession } from '@/src/session';
import { wrap } from '@/src/http';

// 当前用户的家庭详情: 未加入家庭返回 family:null；创建者额外带上待审核申请列表
export const GET = wrap(async () => {
  const { session, response } = await requireSession();
  if (response) return response;

  // 不在家庭里: 带上我提交的、还在等审核的申请(可以撤回)
  if (!session.familyId) return NextResponse.json({ family: null, myApplications: await dbApi.listMyApplications(session.userId) });

  const members = await dbApi.listFamilyMembers(session.familyId);
  const pendingRequests = session.isFamilyCreator ? await dbApi.listPendingRequests(session.familyId) : [];
  return NextResponse.json({
    userId: session.userId,
    family: { id: session.familyId, name: session.familyName },
    role: session.familyRole || null,
    isCreator: !!session.isFamilyCreator,
    members,
    pendingRequests,
    myApplications: [],
  });
});
