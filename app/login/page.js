import LoginClient from '@/components/LoginClient';

export const metadata = {
  title: '登录 · VanSpend',
};

// 服务端组件，只为读 ?mode=register(落地页"免费注册" CTA 的落点)。
// 走 searchParams 这个 page prop 而不是 useSearchParams()，就不需要 Suspense 边界。
export default async function LoginPage({ searchParams }) {
  const { mode } = await searchParams;
  return <LoginClient initialMode={mode === 'register' ? 'register' : 'login'} />;
}
