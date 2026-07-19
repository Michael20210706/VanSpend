import { NextResponse } from 'next/server';
import { getSession } from '@/src/session';

export async function GET() {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: '未登录' }, { status: 401 });
  return NextResponse.json({ id: session.userId, username: session.username });
}
