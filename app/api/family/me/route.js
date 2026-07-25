import { NextResponse } from 'next/server';
import dbApi from '@/src/db.cjs';
import { requireSession } from '@/src/session';
import { wrap } from '@/src/http';

// 当前用户的家庭详情: 未加入家庭返回 family:null；创建者额外带上待审核申请列表
export const GET = wrap(async () => {
  const { session, response } = await requireSession();
  if (response) return response;

  if (!session.familyId) return NextResponse.json({ family: null });

  const members = await dbApi.listFamilyMembers(session.familyId);
  const pendingRequests = session.isFamilyCreator ? await dbApi.listPendingRequests(session.familyId) : [];
  return NextResponse.json({
    family: { id: session.familyId, name: session.familyName },
    role: session.familyRole || null,
    isCreator: !!session.isFamilyCreator,
    members,
    pendingRequests,
  });
});
