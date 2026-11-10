'use client';
import Link from 'next/link';
import { useState } from 'react';
import ChangePasswordModal from './ChangePasswordModal';
import FeedbackModal from './FeedbackModal';
import InviteModal from './InviteModal';
import DeleteAccountModal from './DeleteAccountModal';

export default function Header({ cfg, user, onLogout, onAccountDeleted }) {
  const [showPwd, setShowPwd] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  return (
    <>
      <header>
        <h1>🧾 VanSpend</h1>
        <span className="meta header-desc">温哥华家庭小票精细化记账 · GST/PST 拆分</span>
        <span className={'badge ' + (cfg.hasKey ? 'ok' : 'no')}>{cfg.hasKey ? 'Key 已配置' : 'Key 未配置 (改 .env)'}</span>
        <span className="meta header-desc">{cfg.model ? '模型: ' + cfg.model : ''}</span>
        <span style={{ flex: 1 }} />
        {user ? (
          <span className="meta">
            {user.isAdmin ? <><Link href="/admin">管理后台</Link> · </> : null}
            {user.username} · <a href="#" onClick={(e) => { e.preventDefault(); setShowPwd(true); }}>修改密码</a>
            {' · '}<a href="#" onClick={(e) => { e.preventDefault(); setShowInvite(true); }}>邀请</a>
            {' · '}<a href="#" onClick={(e) => { e.preventDefault(); setShowFeedback(true); }}>意见反馈</a>
            {user.isAdmin ? null : <>{' · '}<a href="#" onClick={(e) => { e.preventDefault(); setShowDelete(true); }}>注销账号</a></>}
            {' · '}<a href="#" onClick={(e) => { e.preventDefault(); onLogout(); }}>退出</a>
          </span>
        ) : null}
      </header>
      {showPwd ? <ChangePasswordModal onClose={() => setShowPwd(false)} /> : null}
      {showFeedback ? <FeedbackModal onClose={() => setShowFeedback(false)} /> : null}
      {showInvite ? <InviteModal onClose={() => setShowInvite(false)} /> : null}
      {showDelete ? <DeleteAccountModal onClose={() => setShowDelete(false)} onDeleted={onAccountDeleted} /> : null}
    </>
  );
}
