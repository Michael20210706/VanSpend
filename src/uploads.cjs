'use strict';

const fs = require('fs');
const path = require('path');

// process.cwd() 而非 __dirname: __dirname 在 Next.js/Turbopack 构建打包后会被虚拟化成非真实路径，
// process.cwd() 是真实的进程工作目录(项目根目录/Docker 里的 WORKDIR)，不受打包影响
// UPLOAD_DIR 环境变量只给测试用(指到临时目录，不污染真实 uploads/)；正常运行不设
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// 单张图片上限(解码后的字节数)。前端会先压缩到长边 2000 像素，正常小票照片远小于此
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// data URL 中 base64 部分解码后的字节数(不真正解码，避免为超大图分配内存)。调用方须先确认是字符串
function dataUrlBytes(dataUrl) {
  const s = dataUrl;
  const comma = s.indexOf(',');
  const b64 = comma >= 0 ? s.slice(comma + 1) : s;
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

// 路由用: 判断客户端传来的 image 字段。只接受 png/jpeg/webp/gif 的 base64 data URL(与 /uploads 能提供的扩展名一致)；
// 非字符串(数组、对象等)一律视为非法——
// 否则大小检查和 saveImage 的正则会对同一个值得出不同结论(正则会把数组隐式转成字符串)
// 返回 null 表示合法，否则返回 { status, error }
function checkImage(image) {
  if (typeof image !== 'string' || !/^data:image\/(png|jpe?g|webp|gif);base64,/.test(image)) {
    return { status: 400, error: '图片格式错误' };
  }
  if (dataUrlBytes(image) > MAX_IMAGE_BYTES) return { status: 413, error: '图片超过 10 MB' };
  return null;
}

// 把 dataUrl 存成图片文件，返回文件名
function saveImage(dataUrl) {
  // 自身再兜一层(不依赖调用方先 checkImage): 非字符串或超限一律不写盘
  if (typeof dataUrl !== 'string' || dataUrlBytes(dataUrl) > MAX_IMAGE_BYTES) return null;
  const m = /^data:(image\/(?:png|jpe?g|webp|gif));base64,(.+)$/s.exec(dataUrl);
  if (!m) return null;
  const ext = m[1].split('/')[1].replace('jpeg', 'jpg');
  const file = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, file), Buffer.from(m[2], 'base64'));
  return file;
}

module.exports = { UPLOAD_DIR, MAX_IMAGE_BYTES, dataUrlBytes, checkImage, saveImage };
