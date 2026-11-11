import { NextResponse } from 'next/server';
import receiptInput from './receiptInput.cjs';

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

// 读小票/统计时的可见范围: 在家庭里 = 整个家庭 + 我自己的(加入家庭之前记的个人小票没有家庭归属，只靠家庭条件会从本人视图里
// 消失；而别人的个人小票两个条件都不满足，仍然私有)；不在家庭 = 只有我自己的。语义见 src/db.cjs 的 scopeClause()。
export function memberScope(session) {
  return session.familyId
    ? { familyId: session.familyId, userId: session.userId }
    : { userId: session.userId };
}

// 路由里的 [id] 段: 只接受纯数字(正整数)，否则返回 null，调用方应回 400。
// 裸的 +id 会把 '1abc' / 'abc' 变成 NaN 再绑进 SQL，最好的结果是 404，坏的结果是 500 带出数据库报错信息
export function parseId(raw) {
  const s = String(raw ?? '');
  if (!/^\d{1,15}$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

// 从请求体里读一个字符串字段，是所有路由读字符串的唯一入口: 缺省/null 视为空串，其它类型(数字、数组、对象、布尔)一律 400，
// 避免对非字符串调用 .trim() 或交给 bcrypt 后抛成 500 并泄露内部报错。
//   label: 用在提示里的字段名；emptyMessage: required 且为空时的提示；tooLong: 超长时的提示(默认 `${label}不能超过 ${max} 个字符`)
//   trim: 默认去首尾空格(密码传 false)；max: 最大字符数(按 Unicode 码点数，与 MySQL utf8mb4 的 VARCHAR 长度一致)；
//   maxBytes: 最大 UTF-8 字节数(bcrypt 只看前 72 字节，更长的部分会被悄悄截掉)
export function readString(body, key, { label = key, required = false, emptyMessage, trim = true, max, maxBytes, tooLong, tooManyBytes } = {}) {
  const raw = body[key];
  if (raw !== undefined && raw !== null && typeof raw !== 'string') throw new HttpError(400, `${label}格式错误`);
  let s = raw || '';
  if (trim) s = s.trim();
  if (required && !s) throw new HttpError(400, emptyMessage || `请填写${label}`);
  if (max !== undefined && Array.from(s).length > max) throw new HttpError(400, tooLong || `${label}不能超过 ${max} 个字符`);
  if (maxBytes !== undefined && Buffer.byteLength(s, 'utf8') > maxBytes) {
    throw new HttpError(400, tooManyBytes || `${label}太长(最多 ${maxBytes} 个字节，一个汉字约占 3 个字节)`);
  }
  return s;
}

// 新设置的密码: bcrypt 只使用前 72 字节，超出部分被悄悄忽略，所以直接拒绝
export const PASSWORD_MAX_BYTES = 72;

// 查询参数里的日期: 缺省/空串 = 不限；否则必须是真实存在的 YYYY-MM-DD，否则 400。
// 不校验的话，emoji/零宽字符/BOM 绑进 DATE 比较会让 MySQL 抛字符集转换错误(500)
export function readDateParam(searchParams, key) {
  const v = searchParams.get(key);
  if (v === null || v === '') return undefined;
  if (!receiptInput.realDate(v)) throw new HttpError(400, `${key} 日期格式应为 YYYY-MM-DD`);
  return v;
}

// 管理员路由的 userId 筛选: 缺省/空串 = 全部用户；否则必须是正整数，否则 400(以前非数字被悄悄当成"不筛选"或 NaN)
export function readIdParam(searchParams, key) {
  const v = searchParams.get(key);
  if (v === null || v === '') return undefined;
  const id = parseId(v);
  if (id === null) throw new HttpError(400, `${key} 必须是正整数`);
  return id;
}

// 请求体上限: 登录/注册等普通表单 16 KB；带图片的接口 16 MB(10 MB 图片的 base64 约 13.4 MB，加上明细 JSON 留余量)
export const FORM_BODY_MAX = 16 * 1024;
export const IMAGE_BODY_MAX = 16 * 1024 * 1024;
// 编辑小票: 最多 300 条明细，每条约 0.5 KB，256 KB 足够
export const EDIT_BODY_MAX = 256 * 1024;

// 统一错误响应，对应旧 Express 版本 server.js 里的 wrap()
export function wrap(handler) {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
      // 意料之外的异常: 完整错误只写服务端日志，响应里不带内部报错(SQL 文本、库的参数报错等)
      console.error(e);
      return NextResponse.json({ error: '服务器内部错误，请稍后重试' }, { status: 500 });
    }
  };
}
