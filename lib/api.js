let unauthorizedHandler = null;

// 被 app/page.js 注册；会话过期(401)时触发,统一弹回未登录界面。
// 返回一个注销函数,给 useEffect 当 cleanup 用——否则页面卸载(例如客户端跳到 /login)后
// 这里仍握着已卸载组件的 setState
export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = fn;
  return () => { if (unauthorizedHandler === fn) unauthorizedHandler = null; };
}

export async function api(url, opts) {
  const r = await fetch(url, opts);
  const j = await r.json();
  if (!r.ok) {
    // /api/auth/* 的 401 是"这次表单填错了",不是"会话过期",不能触发弹回登录:
    //   login 401 = 用户名或密码错误、password 401 = 当前密码不正确、me 401 = 未登录时的正常探测
    if (r.status === 401 && unauthorizedHandler && !url.startsWith('/api/auth/')) unauthorizedHandler();
    throw new Error(j.error || '请求失败');
  }
  return j;
}

export const fmt = (n) => (n == null || isNaN(n))
  ? '-'
  : Number(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
