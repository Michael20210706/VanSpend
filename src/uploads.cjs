'use strict';

const fs = require('fs');
const path = require('path');

// process.cwd() 而非 __dirname: __dirname 在 Next.js/Turbopack 构建打包后会被虚拟化成非真实路径，
// process.cwd() 是真实的进程工作目录(项目根目录/Docker 里的 WORKDIR)，不受打包影响
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// 把 dataUrl 存成图片文件，返回文件名
function saveImage(dataUrl) {
  const m = /^data:(image\/\w+);base64,(.+)$/s.exec(dataUrl || '');
  if (!m) return null;
  const ext = m[1].split('/')[1].replace('jpeg', 'jpg');
  const file = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, file), Buffer.from(m[2], 'base64'));
  return file;
}

module.exports = { UPLOAD_DIR, saveImage };
