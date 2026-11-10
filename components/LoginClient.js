'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import AuthGate from './AuthGate';
import Toast from './Toast';
import './landing/landing.css';

export default function LoginClient({ initialMode, initialCode = '' }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  function handleLoggedIn(u) {
    // 申请加入家庭是"已注册但还在等审核"，直接跳走的话 AuthGate 紧跟着发的那条 toast
    // 会随页面卸载一起丢掉(lib/toast.js 没有缓冲)，所以这里改成一张留在页面上的卡片
    if (u?.pendingFamilyRequest) { setPending(true); return; }
    router.replace('/');
  }

  return (
    <div className="lp-auth">
      <Link href="/" className="lp-auth-mark">VanSpend</Link>

      {pending ? (
        <div className="card">
          <h2>账号已创建</h2>
          <p className="muted" style={{ margin: '0 0 16px' }}>
            加入家庭的申请已提交，等家庭创建者通过后，刷新页面就能看到共享的账本。
            在那之前可以先以个人身份记账。
          </p>
          <button onClick={() => router.replace('/')}>进入应用</button>
        </div>
      ) : (
        <AuthGate initialMode={initialMode} initialCode={initialCode} onLoggedIn={handleLoggedIn} />
      )}

      <p className="lp-auth-note">
        注册开放自助完成，需要填一道图形算式验证码。个人账号可以之后再加入家庭。
      </p>

      <Toast />
    </div>
  );
}
