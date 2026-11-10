import { NextResponse } from 'next/server';

// 真实客户端 IP。公网经 Cloudflare Tunnel 进来时，应用看到的连接方是 cloudflared，真实 IP 在
// CF-Connecting-IP(由 Cloudflare 边缘写入、客户端无法伪造)。这个头可信的前提是应用端口不对公网暴露、
// 只能经 Tunnel 访问(见 docker-compose.yml)。
// Route Handler 拿不到 socket 地址，没有 CF-Connecting-IP 时只能退回 X-Forwarded-For: Next 只在客户端
// 没带这个头时才用 socket 地址补上，客户端自己带的会原样保留——所以这个回退只在"不经 Tunnel"的本地访问时
// 才会用到，且可被伪造。两个头都没有时返回 null，调用方应跳过按 IP 的判断(而不是把所有人归进同一个桶)。
export function clientIp(request) {
  const h = request.headers;
  const cf = h.get('cf-connecting-ip');
  if (cf && cf.trim()) return cf.trim();
  const xff = h.get('x-forwarded-for');
  if (xff && xff.split(',')[0].trim()) return xff.split(',')[0].trim();
  return null;
}

// 带状态码的错误: 在 wrap() 里转成对应状态的 { error } 响应(其余异常仍是 500)
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// 有上限地读取 JSON 请求体: 先看 Content-Length，再边读边计数，超过 maxBytes 立刻中止(413)，
// 不会把超大请求体整个读进内存；JSON 格式错误或不是对象返回 400。所有路由都用它代替裸的 request.json()。
export async function readJson(request, maxBytes) {
  const declared = Number(request.headers.get('content-length'));
  if (declared > maxBytes) throw new HttpError(413, '请求体过大');
  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, '请求体过大');
    }
    chunks.push(Buffer.from(value));
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new HttpError(400, '请求格式错误');
  }
  // 所有接口的请求体都是 JSON 对象；null、数组、数字等合法 JSON 也一律 400(否则解构字段时会抛成 500)
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, '请求格式错误');
  return data;
}

// 路由里的 [id] 段: 只接受纯数字(正整数)，否则返回 null，调用方应回 400。
// 裸的 +id 会把 '1abc' / 'abc' 变成 NaN 再绑进 SQL，最好的结果是 404，坏的结果是 500 带出数据库报错信息
export function parseId(raw) {
  const s = String(raw ?? '');
  if (!/^\d{1,15}$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

// 请求体上限: 登录/注册等普通表单 16 KB；带图片的接口 16 MB(10 MB 图片的 base64 约 13.4 MB，加上明细 JSON 留余量)
export const FORM_BODY_MAX = 16 * 1024;
export const IMAGE_BODY_MAX = 16 * 1024 * 1024;

// 统一错误响应，对应旧 Express 版本 server.js 里的 wrap()
export function wrap(handler) {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
      console.error(e);
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
  };
}
