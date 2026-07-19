import { NextResponse } from 'next/server';
import dbApi from '@/src/db.cjs';
import { requireAdmin } from '@/src/session';
import { wrap } from '@/src/http';

export const GET = wrap(async () => {
  const { response } = await requireAdmin();
  if (response) return response;

  const rows = await dbApi.listUsers();
  return NextResponse.json(rows);
});
