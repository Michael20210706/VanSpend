let unauthorizedHandler = null;

// 被 app/page.js 注册；会话过期(401)时触发,统一弹回未登录界面。
// 返回一个注销函数,给 useEffect 当 cleanup 用——否则页面卸载(例如客户端跳到 /login)后
// 这里仍握着已卸载组件的 setState
export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = fn;
  return () => { if (unauthorizedHandler === fn) unauthorizedHandler = null; };
}

let passwordChangeHandler = null;

// 管理员重置密码后，用户已打开的页面里所有接口都会回 403 password_change_required；
// app/page.js 注册的回调会重新读取 /api/auth/me，从而弹出强制改密码界面
export function setPasswordChangeHandler(fn) {
  passwordChangeHandler = fn;
  return () => { if (passwordChangeHandler === fn) passwordChangeHandler = null; };
}

export async function api(url, opts) {
  const r = await fetch(url, opts);
  const j = await r.json();
  if (!r.ok) {
    // /api/auth/* 的 401 是"这次表单填错了",不是"会话过期",不能触发弹回登录:
    //   login 401 = 用户名或密码错误、password 401 = 当前密码不正确、me 401 = 未登录时的正常探测
    if (r.status === 401 && unauthorizedHandler && !url.startsWith('/api/auth/')) unauthorizedHandler();
    if (r.status === 403 && j.code === 'password_change_required' && passwordChangeHandler && !url.startsWith('/api/auth/')) {
      // 页面马上会被改密码界面替换；返回一个永不结束的 promise，避免各组件(多数没有 catch)报未捕获的 rejection、闪出空状态
      passwordChangeHandler();
      return new Promise(() => {});
    }
    throw new Error(j.error || '请求失败');
  }
  return j;
}

export const fmt = (n) => (n == null || isNaN(n))
  ? '-'
  : Number(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
