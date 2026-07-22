'use strict';

const crypto = require('crypto');

// 注册页人机验证：服务端出一道算式题，渲染成带干扰线/字符旋转的 SVG 图片而非明文字段返回
// (明文题目哪怕只是 JSON 字段，脚本都能不做 OCR 直接读值作答，等于没有防护)。
// 答案不落库/不存会话，用 SESSION_SECRET 签进返回给前端的 token 里，提交注册时原样带回并校验签名+有效期。
const TTL_MS = 5 * 60 * 1000;
const SECRET = process.env.SESSION_SECRET || 'vanspend-captcha-fallback-secret';
const COLORS = ['#5b8def', '#e2685c', '#57b894', '#d9a441', '#b98fe8', '#e6e6e6'];

function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
}

function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 手写 SVG，不引入第三方验证码库：每个字符独立随机旋转/位移/配色，叠加干扰线和干扰点，
// 提高机器 OCR 识别难度，同时保持纯文本+样式，无需额外 npm 依赖或图像处理库
function renderSvg(text) {
  const width = 150;
  const height = 48;
  const step = (width - 16) / text.length;
  let glyphs = '';
  for (let i = 0; i < text.length; i++) {
    const cx = 12 + i * step + step / 2 + rand(-3, 3);
    const cy = height / 2 + rand(-5, 5);
    const rotate = rand(-18, 18);
    const size = rand(20, 26);
    glyphs += `<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" font-size="${size.toFixed(1)}" font-family="Menlo, Consolas, 'Courier New', monospace" font-weight="700" fill="${pick(COLORS)}" text-anchor="middle" dominant-baseline="middle" transform="rotate(${rotate.toFixed(1)} ${cx.toFixed(1)} ${cy.toFixed(1)})">${escapeXml(text[i])}</text>`;
  }
  let noise = '';
  for (let i = 0; i < 4; i++) {
    noise += `<path d="M${rand(0, width).toFixed(1)} ${rand(0, height).toFixed(1)} Q${rand(0, width).toFixed(1)} ${rand(0, height).toFixed(1)} ${rand(0, width).toFixed(1)} ${rand(0, height).toFixed(1)}" stroke="${pick(COLORS)}" stroke-width="1" fill="none" opacity="0.45"/>`;
  }
  for (let i = 0; i < 18; i++) {
    noise += `<circle cx="${rand(0, width).toFixed(1)}" cy="${rand(0, height).toFixed(1)}" r="1" fill="${pick(COLORS)}" opacity="0.5"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#20242f"/>${noise}${glyphs}</svg>`;
}

function generate() {
  const a = crypto.randomInt(1, 10);
  const b = crypto.randomInt(1, 10);
  const op = crypto.randomInt(0, 2) === 0 ? '+' : '-';
  const answer = op === '+' ? a + b : a - b;
  const image = `data:image/svg+xml;base64,${Buffer.from(renderSvg(`${a}${op}${b}=?`)).toString('base64')}`;
  const payload = `${answer}:${Date.now() + TTL_MS}`;
  const token = `${Buffer.from(payload).toString('base64url')}.${sign(payload)}`;
  return { image, token };
}

function verify(token, answer) {
  if (!token || typeof token !== 'string') return false;
  const dotIndex = token.lastIndexOf('.');
  if (dotIndex < 0) return false;
  const encoded = token.slice(0, dotIndex);
  const sig = token.slice(dotIndex + 1);
  let payload;
  try {
    payload = Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return false;
  }
  if (!safeEqual(sign(payload), sig)) return false;
  const [expectedAnswer, expiresAt] = payload.split(':');
  if (Date.now() > Number(expiresAt)) return false;
  return String(answer ?? '').trim() === expectedAnswer;
}

module.exports = { generate, verify };
