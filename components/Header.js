'use client';
import Link from 'next/link';

export default function Header({ cfg, user, onLogout }) {
  return (
    <header>
      <h1>🧾 VanSpend</h1>
      <span className="meta header-desc">温哥华家庭小票精细化记账 · GST/PST 拆分</span>
      <span className={'badge ' + (cfg.hasKey ? 'ok' : 'no')}>{cfg.hasKey ? 'Key 已配置' : 'Key 未配置 (改 .env)'}</span>
      <span className="meta header-desc">{cfg.model ? '模型: ' + cfg.model : ''}</span>
      <span style={{ flex: 1 }} />
      {user ? (
        <span className="meta">
          {user.isAdmin ? <><Link href="/admin">管理后台</Link> · </> : null}
          {user.username} · <a href="#" onClick={(e) => { e.preventDefault(); onLogout(); }}>退出</a>
        </span>
      ) : null}
    </header>
  );
}
