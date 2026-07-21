'use client';
import { useState } from 'react';
import { api } from '../lib/api';
import { showToast } from '../lib/toast';

export default function ChangePasswordModal({ onClose }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [err, setErr] = useState('');

  async function submit() {
    if (!currentPassword || !newPassword) { setErr('请输入当前密码和新密码'); return; }
    if (newPassword !== confirmPassword) { setErr('两次输入的新密码不一致'); return; }
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
      onClick={onClose}
    >
      <div className="card" style={{ width: 320 }} onClick={(e) => e.stopPropagation()}>
        <h2>修改密码</h2>
        <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
          <input
            type="password" placeholder="当前密码" autoComplete="current-password"
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
            <button onClick={onClose} style={{ background: 'var(--line)', color: 'inherit' }}>取消</button>
          </div>
        </div>
      </div>
    </div>
  );
}
