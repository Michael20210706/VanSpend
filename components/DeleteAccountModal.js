'use client';
import { useState } from 'react';
import { api } from '../lib/api';
import useModal from '../lib/useModal';

// 自助注销账号: 输入密码确认。小票、明细和原图会一并永久删除，不可恢复。
// 家庭创建者会被服务端拒绝(提示先转让或解散家庭)；错误直接显示在弹窗里。
export default function DeleteAccountModal({ onClose, onDeleted }) {
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const boxRef = useModal(onClose);

  async function submit() {
    if (!password) { setErr('请输入密码确认'); return; }
    setBusy(true);
    try {
      await api('/api/auth/delete-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      onDeleted();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
      onClick={onClose}
    >
      <div className="card" ref={boxRef} role="dialog" aria-modal="true" style={{ width: 340 }} onClick={(e) => e.stopPropagation()}>
        <h2>注销账号</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          注销后，你名下的所有小票、明细和原图都会被永久删除，无法恢复。如果你是家庭创建者，需要先转让创建者身份或解散家庭。
        </p>
        <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
          <input
            type="password" placeholder="输入当前密码确认" autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)}
          />
          <span style={{ color: 'var(--bad)', fontSize: 13 }}>{err}</span>
          <div className="row">
            <button className="danger" disabled={busy} onClick={submit}>永久注销</button>
            <button onClick={onClose} style={{ background: 'var(--line)', color: 'inherit' }}>取消</button>
          </div>
        </div>
      </div>
    </div>
  );
}
