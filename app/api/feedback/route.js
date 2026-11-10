import { NextResponse } from 'next/server';
import dbApi from '@/src/db.cjs';
import { requireSession } from '@/src/session';
import { wrap, readJson, FORM_BODY_MAX } from '@/src/http';

// 提交反馈 / 查看自己提交过的反馈(不是公开留言板，看不到别人提交的内容)
export const GET = wrap(async () => {
  const { session, response } = await requireSession();
  if (response) return response;
  const rows = await dbApi.listFeedbackByUser(session.userId);
  return NextResponse.json(rows);
});

export const POST = wrap(async (request) => {
  const { session, response } = await requireSession();
  if (response) return response;

  const body = await readJson(request, FORM_BODY_MAX);
  const content = (body.content || '').trim();
  if (!content) return NextResponse.json({ error: '反馈内容不能为空' }, { status: 400 });
  if (content.length > 2000) return NextResponse.json({ error: '内容过长(最多 2000 字)' }, { status: 400 });

  const id = await dbApi.addFeedback(session.userId, content);
  return NextResponse.json({ id });
});
