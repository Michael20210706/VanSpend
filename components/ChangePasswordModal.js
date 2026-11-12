'use client';
import { useState } from 'react';
import { api } from '../lib/api';
import { showToast } from '../lib/toast';
import useModal from '../lib/useModal';

// forced: 管理员重置过密码、必须先改密码的账号——不能关闭、不能取消，改完才进入应用
export default function ChangePasswordModal({ onClose, forced = false, onLogout }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [err, setErr] = useState('');
  const boxRef = useModal(onClose, !forced);

  async function submit() {
    if (!currentPassword || !newPassword) { setErr('请输入当前密码和新密码'); return; }
    if (newPassword !== confirmPassword) { setErr('两次输入的新密码不一致'); return; }
    if (newPassword === currentPassword) { setErr('新密码不能和当前密码相同'); return; }
    try {
      await api('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      showToast('密码已修改');
      onClose();
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
      }}
      onClick={forced ? undefined : onClose}
    >
      <div className="card" ref={boxRef} role="dialog" aria-modal="true" style={{ width: 320 }} onClick={(e) => e.stopPropagation()}>
        <h2>{forced ? '请先修改密码' : '修改密码'}</h2>
        {forced ? <p className="muted" style={{ marginTop: 0 }}>管理员为你重置了密码。请输入临时密码作为当前密码，并设置一个新密码，之后才能继续使用。</p> : null}
        <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
          <input
            type="password" placeholder={forced ? '临时密码' : '当前密码'} autoComplete="current-password"
            value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}
          />
          <input
            type="password" placeholder="新密码" autoComplete="new-password"
            value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
          />
          <input
            type="password" placeholder="确认新密码" autoComplete="new-password"
            value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
          />
          <span style={{ color: 'var(--bad)', fontSize: 13 }}>{err}</span>
          <div className="row">
            <button onClick={submit}>确定</button>
            {forced ? null : <button onClick={onClose} style={{ background: 'var(--line)', color: 'inherit' }}>取消</button>}
          </div>
          {forced && onLogout ? (
            <a href="#" onClick={(e) => { e.preventDefault(); onLogout(); }}>退出登录</a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
