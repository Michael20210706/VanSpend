'use strict';

const crypto = require('crypto');

// 注册页人机验证：服务端出一道算式题，渲染成带干扰线/字符旋转的 SVG 图片而非明文字段返回
// (明文题目哪怕只是 JSON 字段，脚本都能不做 OCR 直接读值作答，等于没有防护)。
// 答案不落库/不存会话，也不以明文放进 token：token 里只有"答案的 HMAC"，用 SESSION_SECRET 签名，提交注册时原样带回并校验签名+有效期+答案。
const TTL_MS = 5 * 60 * 1000;
// 签名密钥: 必须是不公开的值。SESSION_SECRET 没设、或短于 32 个字符(.env.example 里的占位值就只有 28 个，iron-session 也要求至少 32)时，
// 改用每次启动随机生成的密钥——和 src/session.js 一样: 重启后旧验证码失效，但绝不能回退到写死在代码里的常量，
// 否则任何人都能伪造一个答案已知的验证码 token，批量开"开放注册"账号
const ENV_SECRET = process.env.SESSION_SECRET;
const SECRET = ENV_SECRET && ENV_SECRET.length >= 32 ? ENV_SECRET : crypto.randomBytes(32).toString('hex');
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

// token 格式(严格): base64url(payload) + '.' + 小写 hex 签名，payload = `过期时间戳:nonce:答案的 HMAC`。
// 答案不以明文出现在 token 里(否则脚本不用识图，直接解码 token 就能读到答案)，只存 HMAC(密钥, nonce:答案)；
// 答案是一位数加减(约 27 种)，所以离线靠猜 HMAC 不可行(没有密钥)，在线靠反复试同一个 token 则被"用过即作废"挡住(见注册路由)。
const TOKEN_RE = /^([A-Za-z0-9_-]+)\.([0-9a-f]{64})$/;
const PAYLOAD_RE = /^(\d+):([0-9a-f]{16}):([0-9a-f]{64})$/;
const answerMac = (nonce, answer) => sign(`a:${nonce}:${answer}`);

function generate() {
  const a = crypto.randomInt(1, 10);
  const b = crypto.randomInt(1, 10);
  const op = crypto.randomInt(0, 2) === 0 ? '+' : '-';
  const answer = op === '+' ? a + b : a - b;
  const image = `data:image/svg+xml;base64,${Buffer.from(renderSvg(`${a}${op}${b}=?`)).toString('base64')}`;
  // 随机 nonce 让每个 token 的签名都不同(同一毫秒、同一答案也不会撞)
  const nonce = crypto.randomBytes(8).toString('hex');
  const payload = `${Date.now() + TTL_MS}:${nonce}:${answerMac(nonce, answer)}`;
  const token = `${Buffer.from(payload).toString('base64url')}.${sign(payload)}`;
  return { image, token };
}

// 严格解析: 格式必须正好是 base64url(payload).hex，payload 重新编码后必须与原文完全一致(规范编码)，
// 签名对、没过期才返回 { nonce, mac, sig }。任何"宽松解码也能解出同一个 payload"的变体(补 =、空白、多余的点、
// 前缀垃圾字符、标准 base64 字母、大写 hex)都在这里被拒，所以一个已签发的 token 只有唯一一种合法写法
function parse(token) {
  if (typeof token !== 'string') return null;
  const m = TOKEN_RE.exec(token);
  if (!m) return null;
  const payload = Buffer.from(m[1], 'base64url').toString('utf8');
  if (Buffer.from(payload).toString('base64url') !== m[1]) return null;
  if (!safeEqual(sign(payload), m[2])) return null;
  const f = PAYLOAD_RE.exec(payload);
  if (!f || Date.now() > Number(f[1])) return null;
  return { nonce: f[2], mac: f[3], sig: m[2] };
}

// token 本身是否有效(签名对、没过期)，不看答案。注册路由用它给"签名有效但答案错"的 token 也记一次使用——
// 否则答案是一位数加减(约 27 种可能)，同一个 token 可以反复猜到对为止
function isWellFormed(token) {
  return parse(token) !== null;
}

function verify(token, answer) {
  const p = parse(token);
  if (!p) return false;
  return safeEqual(answerMac(p.nonce, String(answer ?? '').trim()), p.mac);
}

// 一次性使用的键: 有效 token 用它的签名(HMAC，带 nonce，每个签发的 token 唯一，且上面保证了写法唯一)；
// 不是有效 token 的(只会出现在测试用的 mock 里)退回 SHA-256。只在 token 通过 verify/isWellFormed 之后才用于写库
function tokenKey(token) {
  const p = parse(token);
  if (p) return p.sig;
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

module.exports = { generate, verify, isWellFormed, tokenKey };
