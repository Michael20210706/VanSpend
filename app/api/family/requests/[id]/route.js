import { NextResponse } from 'next/server';
import dbApi from '@/src/db.cjs';
import { requireFamilyCreator } from '@/src/session';
import { wrap, readJson, FORM_BODY_MAX } from '@/src/http';

// 创建者审核申请: body { decision: 'approve' | 'reject' }
export const POST = wrap(async (request, { params }) => {
  const { session, response } = await requireFamilyCreator();
  if (response) return response;

  const { id } = await params;
  const body = await readJson(request, FORM_BODY_MAX);
  if (body.decision !== 'approve' && body.decision !== 'reject') {
    return NextResponse.json({ error: 'decision 必须是 approve 或 reject' }, { status: 400 });
  }

  const ok = await dbApi.decideRequest(+id, session.familyId, body.decision === 'approve');
  if (!ok) return NextResponse.json({ error: '申请不存在或已处理' }, { status: 404 });
  return NextResponse.json({ decided: true });
});
