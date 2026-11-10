import { NextResponse } from 'next/server';
import dbApi from '@/src/db.cjs';
import { requireFamilyCreator } from '@/src/session';
import { wrap, readJson, parseId, FORM_BODY_MAX } from '@/src/http';

// 创建者审核申请: body { decision: 'approve' | 'reject' }
export const POST = wrap(async (request, { params }) => {
  const { session, response } = await requireFamilyCreator();
  if (response) return response;

  const id = parseId((await params).id);
  if (id === null) return NextResponse.json({ error: '无效的 id' }, { status: 400 });
  const body = await readJson(request, FORM_BODY_MAX);
  if (body.decision !== 'approve' && body.decision !== 'reject') {
    return NextResponse.json({ error: 'decision 必须是 approve 或 reject' }, { status: 400 });
  }

  // session.userId 一并传下去: 在事务里、拿到家庭行锁之后再核对一次"你还是这个家庭的创建者"
  const ok = await dbApi.decideRequest(id, session.familyId, body.decision === 'approve', session.userId);
  if (ok === 'forbidden') return NextResponse.json({ error: '无权限' }, { status: 403 });
  if (ok === 'applicant_in_family') return NextResponse.json({ error: '申请人已经加入了其他家庭，这条申请已作废' }, { status: 409 });
  if (!ok) return NextResponse.json({ error: '申请不存在或已处理' }, { status: 404 });
  return NextResponse.json({ decided: true });
});
