'use client';
import { useState } from 'react';
import { api } from '../lib/api';

export default function AuthGate({ onLoggedIn }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [captcha, setCaptcha] = useState(null); // { image, token }
  const [captchaAnswer, setCaptchaAnswer] = useState('');

  async function loadCaptcha() {
    setCaptchaAnswer('');
    try {
      setCaptcha(await api('/api/auth/captcha'));
    } catch {
      setCaptcha(null); // 出题失败(如网络问题)时留空，提交会被后端拒绝并提示重新验证
    }
  }

  function resetForm() {
    setUsername('');
    setPassword('');
    setCaptchaAnswer('');
    setErr('');
  }

  async function submit() {
    if (!username.trim() || !password) { setErr('请输入用户名和密码'); return; }
    if (mode === 'register' && !captchaAnswer.trim()) { setErr('请完成验证码'); return; }
    try {
      const u = await api('/api/auth/' + mode, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password,
          ...(mode === 'register' ? { captchaToken: captcha?.token, captchaAnswer } : {}),
        }),
      });
      resetForm();
      onLoggedIn(u);
    } catch (e) {
      setErr(e.message);
      if (mode === 'register') {
        setPassword(''); // 密码和验证码答案都清空、换一张图，避免反复重试同一个 token；登录失败不清密码，方便重试
        loadCaptcha();
      }
    }
  }

  function toggleMode() {
    const next = mode === 'login' ? 'register' : 'login';
    setMode(next);
    resetForm();
    if (next === 'register') loadCaptcha();
  }

  return (
    <div className="card">
      <h2>{mode === 'login' ? '登录' : '注册'}</h2>
      <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
        <input placeholder="用户名" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        <input type="password" placeholder="密码" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {mode === 'register' && (
          <div className="row" style={{ gap: 10, alignItems: 'center' }}>
            {captcha ? (
              <img src={captcha.image} alt="验证码图片，请输入图中算式的计算结果" width={150} height={48} style={{ borderRadius: 6, flexShrink: 0 }} />
            ) : (
              <span className="meta" style={{ whiteSpace: 'nowrap' }}>验证码加载中…</span>
            )}
            <input
              placeholder="计算结果"
              inputMode="numeric"
              style={{ flex: 1, minWidth: 0 }}
              value={captchaAnswer}
              onChange={(e) => setCaptchaAnswer(e.target.value)}
            />
            <a href="#" className="meta" style={{ whiteSpace: 'nowrap' }} onClick={(e) => { e.preventDefault(); loadCaptcha(); }}>
              看不清，换一张
            </a>
          </div>
        )}
        <button onClick={submit}>{mode === 'login' ? '登录' : '注册'}</button>
        <span style={{ color: 'var(--bad)', fontSize: 13 }}>{err}</span>
        <a href="#" className="meta" onClick={(e) => { e.preventDefault(); toggleMode(); }}>
          {mode === 'login' ? '没有账号？点此注册' : '已有账号？点此登录'}
        </a>
      </div>
    </div>
  );
}
