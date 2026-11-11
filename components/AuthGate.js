'use client';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { showToast } from '../lib/toast';
import { FAMILY_ROLES } from '../lib/familyRoles';

export default function AuthGate({ onLoggedIn, initialMode = 'login', initialCode = '' }) {
  const [mode, setMode] = useState(initialMode);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [captcha, setCaptcha] = useState(null); // { image, token }
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [familyRole, setFamilyRole] = useState('');
  const [accountType, setAccountType] = useState('individual');
  const [familyAction, setFamilyAction] = useState('create');
  const [familyName, setFamilyName] = useState('');
  const [inviteCode, setInviteCode] = useState(initialCode);
  const hasCode = inviteCode.trim() !== '';

  // 开放注册(没有邀请码)才需要验证码；填了邀请码就不用。直接以注册态打开(落地页的"注册" CTA 带
  // ?mode=register)、或把邀请码清空时，都要补出一道验证码，否则只有 toggleMode() 那条路径会出题
  useEffect(() => {
    if (mode === 'register' && !hasCode && !captcha) loadCaptcha();
  }, [mode, hasCode]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setFamilyRole('');
    setAccountType('individual');
    setFamilyAction('create');
    setFamilyName('');
    setInviteCode('');
    setErr('');
  }

  async function submit(e) {
    e?.preventDefault();
    if (!username.trim() || !password) { setErr('请输入用户名和密码'); return; }
    if (mode === 'register' && !hasCode && !captchaAnswer.trim()) { setErr('请完成验证码'); return; }
    if (mode === 'register' && accountType === 'family' && !familyName.trim()) { setErr('请填写家庭名称'); return; }
    try {
      const u = await api('/api/auth/' + mode, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password,
          ...(mode === 'register' ? {
            ...(hasCode ? { inviteCode: inviteCode.trim() } : { captchaToken: captcha?.token, captchaAnswer }),
            familyRole: familyRole || undefined,
            accountType,
            ...(accountType === 'family' ? { familyAction, familyName: familyName.trim() } : {}),
          } : {}),
        }),
      });
      resetForm();
      onLoggedIn(u);
      if (u.pendingFamilyRequest) showToast('已提交加入家庭的申请，等待创建者审核');
    } catch (e) {
      setErr(e.message);
      if (mode === 'register') {
        setPassword(''); // 密码和验证码答案都清空、换一张图，避免反复重试同一个 token；登录失败不清密码，方便重试
        if (!hasCode) loadCaptcha();
      }
    }
  }

  function toggleMode() {
    const next = mode === 'login' ? 'register' : 'login';
    setMode(next);
    resetForm();
    if (next === 'register') loadCaptcha();
  }
  // (resetForm 会清空邀请码；useEffect 在 hasCode 变化后按需出验证码)

  return (
    <div className="card">
      <h2 style={{ marginBottom: 6 }}>{mode === 'login' ? '登录' : '注册'}</h2>
      <p className="muted" style={{ margin: '0 0 14px', fontSize: 12 }}>
        {mode === 'login' ? '欢迎回来，登录后继续记账' : '有邀请码就填上，不用验证码；没有也可以直接注册(每天识别次数较少)'}
      </p>
      <form className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }} onSubmit={submit}>
        <input placeholder="用户名" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        <input type="password" placeholder="密码" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} />
        {mode === 'register' && (
          <input
            placeholder="邀请码(可选)"
            autoComplete="off"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
          />
        )}
        {mode === 'register' && hasCode && (
          <span className="muted" style={{ fontSize: 12 }}>
            如果这是家庭邀请码，注册后会直接加入对方的家庭，下面的家庭选项将被忽略。
          </span>
        )}
        {mode === 'register' && (
          <>
            <label className="row" style={{ gap: 8 }}>
              家庭角色
              <select value={familyRole} onChange={(e) => setFamilyRole(e.target.value)}>
                {FAMILY_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </label>
            <div className="row" style={{ gap: 14 }}>
              <label className="row" style={{ gap: 4 }}>
                <input type="radio" name="accountType" checked={accountType === 'individual'} onChange={() => setAccountType('individual')} />个人
              </label>
              <label className="row" style={{ gap: 4 }}>
                <input type="radio" name="accountType" checked={accountType === 'family'} onChange={() => setAccountType('family')} />家庭
              </label>
            </div>
            {accountType === 'family' && (
              <>
                <div className="row" style={{ gap: 14 }}>
                  <label className="row" style={{ gap: 4 }}>
                    <input type="radio" name="familyAction" checked={familyAction === 'create'} onChange={() => setFamilyAction('create')} />创建新家庭
                  </label>
                  <label className="row" style={{ gap: 4 }}>
                    <input type="radio" name="familyAction" checked={familyAction === 'apply'} onChange={() => setFamilyAction('apply')} />申请加入已有家庭
                  </label>
                </div>
                <input
                  placeholder={familyAction === 'create' ? '家庭名称(需唯一)' : '要加入的家庭名称'}
                  value={familyName}
                  onChange={(e) => setFamilyName(e.target.value)}
                />
              </>
            )}
          </>
        )}
        {mode === 'register' && !hasCode && (
          <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {captcha ? (
              <img src={captcha.image} alt="验证码图片，请输入图中算式的计算结果" width={150} height={48} style={{ borderRadius: 6, flexShrink: 0 }} />
            ) : (
              <span className="meta" style={{ whiteSpace: 'nowrap' }}>验证码加载中…</span>
            )}
            <input
              placeholder="计算结果"
              inputMode="numeric"
              style={{ flex: '1 1 120px', minWidth: 0 }}
              value={captchaAnswer}
              onChange={(e) => setCaptchaAnswer(e.target.value)}
            />
            <a href="#" className="meta" style={{ whiteSpace: 'nowrap' }} onClick={(e) => { e.preventDefault(); loadCaptcha(); }}>
              看不清，换一张
            </a>
          </div>
        )}
        <button type="submit">{mode === 'login' ? '登录' : '注册'}</button>
        <span style={{ color: 'var(--bad)', fontSize: 13 }}>{err}</span>
        <a href="#" className="meta" onClick={(e) => { e.preventDefault(); toggleMode(); }}>
          {mode === 'login' ? '没有账号？点此注册' : '已有账号？点此登录'}
        </a>
      </form>
    </div>
  );
}
