let unauthorizedHandler = null;

// 被 app/page.js 注册；任何请求收到 401 时触发,统一弹回登录界面(对应旧版 api() 里的 showAuth() 调用)
export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = fn;
}

export async function api(url, opts) {
  const r = await fetch(url, opts);
  const j = await r.json();
  if (!r.ok) {
    if (r.status === 401 && unauthorizedHandler) unauthorizedHandler();
    throw new Error(j.error || '请求失败');
  }
  return j;
}

export const fmt = (n) => (n == null || isNaN(n))
  ? '-'
  : Number(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
