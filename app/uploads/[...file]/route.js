import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import dbApi from '@/src/db.cjs';
import uploadsLib from '@/src/uploads.cjs';
import { getAuthedSession } from '@/src/session';
import { wrap } from '@/src/http';

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
// saveImage() 生成的文件名只会是 "<时间戳>-<随机>.<扩展名>"，单层、无路径分隔符；不符合的一律当不存在。
// 这一条同时就是路径穿越防护: 名字里不可能出现 / \ 或 ..
const SAFE_NAME = /^[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp|gif)$/i;

// 原图只给: 上传者本人、与该小票同家庭的成员、管理员。其余情况(未登录、无权、文件不属于任何小票、
// 文件名非法)一律 404，不区分"不存在"和"无权"，免得被用来探测文件名。
// Cache-Control: private, no-store —— 经 Cloudflare 时 .jpg 等静态扩展名默认会被边缘缓存，
// 不加这个头，一个人有权看到的图会被缓存后发给任何人。
export const GET = wrap(async (request, { params }) => {
  const notFound = () => NextResponse.json({ error: '未找到' }, { status: 404 });
  const { file } = await params;
  const name = Array.isArray(file) ? file.join('/') : file || '';
  if (!SAFE_NAME.test(name)) return notFound();

  const session = await getAuthedSession();
  if (!session) return notFound();

  const owner = await dbApi.findImageOwner(name);
  if (!owner) return notFound();
  const allowed = session.isAdmin
    || owner.user_id === session.userId
    || (owner.family_id != null && owner.family_id === session.familyId);
  if (!allowed) return notFound();

  const filePath = path.join(uploadsLib.UPLOAD_DIR, name);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return notFound();
  const buf = fs.readFileSync(filePath);
  return new NextResponse(buf, {
    headers: {
      'Content-Type': MIME[path.extname(name).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
