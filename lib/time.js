// 数据库(及 API)里的 TIMESTAMP/DATETIME 都是 UTC，以 'YYYY-MM-DD HH:mm:ss' 字符串返回(src/db.cjs 把连接时区固定为 UTC)。
// 界面统一按查看者的本地时区显示。receipts.purchased_at 是纯日期(DATE)，不经过这里。
const DB_TS = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/;

export function parseDbTime(s) {
  const m = typeof s === 'string' ? DB_TS.exec(s) : null;
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)));
  // Date.UTC 会把 13 月、45 日之类滚动进位而不是报错，所以回读核对
  const ok = d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]
    && d.getUTCHours() === +m[4] && d.getUTCMinutes() === +m[5];
  return ok ? d : null;
}

const p2 = (n) => String(n).padStart(2, '0');

export function formatDateTime(s) {
  const d = parseDbTime(s);
  if (!d) return s ? String(s) : '—';
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

// 悬停提示: 数据库里的原始 UTC 值
export function utcTitle(s) {
  return parseDbTime(s) ? `${String(s).slice(0, 19)} UTC` : undefined;
}
