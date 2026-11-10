import LoginClient from '@/components/LoginClient';

export const metadata = {
  title: '登录 · VanSpend',
};

// 服务端组件，只为读 ?mode=register(落地页"免费注册" CTA 的落点)和 ?code=(邀请链接的落点)。
// 走 searchParams 这个 page prop 而不是 useSearchParams()，就不需要 Suspense 边界。
export default async function LoginPage({ searchParams }) {
  const { mode, code } = await searchParams;
  // ?code=<邀请码>: 邀请链接的落点，自动切到注册态并把码填好
  const initialCode = typeof code === 'string' ? code : '';
  return <LoginClient initialMode={mode === 'register' || initialCode ? 'register' : 'login'} initialCode={initialCode} />;
}
