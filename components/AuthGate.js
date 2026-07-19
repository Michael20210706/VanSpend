'use client';
import { useState } from 'react';
import { api } from '../lib/api';

export default function AuthGate({ onLoggedIn }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');

  async function submit() {
    if (!username.trim() || !password) { setErr('请输入用户名和密码'); return; }
    try {
      const u = await api('/api/auth/' + mode, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      setPassword('');
      onLoggedIn(u);
    } catch (e) {
      setErr(e.message);
    }
  }

  function toggleMode() {
    setMode(mode === 'login' ? 'register' : 'login');
    setErr('');
  }

  return (
    <div className="card">
      <h2>{mode === 'login' ? '登录' : '注册'}</h2>
      <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
        <input placeholder="用户名" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        <input type="password" placeholder="密码" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button onClick={submit}>{mode === 'login' ? '登录' : '注册'}</button>
        <span style={{ color: 'var(--bad)', fontSize: 13 }}>{err}</span>
        <a href="#" className="meta" onClick={(e) => { e.preventDefault(); toggleMode(); }}>
          {mode === 'login' ? '没有账号？点此注册' : '已有账号？点此登录'}
        </a>
      </div>
    </div>
  );
}
