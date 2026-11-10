'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Toast from '../../components/Toast';
import UsersPanel from '../../components/admin/UsersPanel';
import ReceiptsPanel from '../../components/admin/ReceiptsPanel';
import StatsPanel from '../../components/admin/StatsPanel';
import FeedbackPanel from '../../components/admin/FeedbackPanel';
import AuditPanel from '../../components/admin/AuditPanel';
import { api } from '../../lib/api';

const TABS = [
  { key: 'stats', label: '统计' },
  { key: 'users', label: '用户管理' },
  { key: 'receipts', label: '票据管理' },
  { key: 'feedback', label: '用户反馈' },
  { key: 'audit', label: '操作日志' },
];

export default function AdminPage() {
  const [user, setUser] = useState(undefined); // undefined=加载中, null=未登录/无权限
  const [cfg, setCfg] = useState({ categories: [] });
  const [tab, setTab] = useState('stats');

  useEffect(() => {
    api('/api/auth/me').then((u) => setUser(u.isAdmin ? u : null)).catch(() => setUser(null));
    api('/api/config').then(setCfg).catch(() => {});
  }, []);

  async function handleLogout() {
    await api('/api/auth/logout', { method: 'POST' });
    // 退出后跳回首页登录，而不是留在 /admin 上把"已退出"误显示成"无权限"
    window.location.href = '/';
  }

  if (user === undefined) return null;

  if (!user) {
    return (
      <div className="wrap" style={{ maxWidth: 420 }}>
        <div className="card">
          <h2>无权限</h2>
          <p className="muted">需要用管理员账号登录后才能访问后台。</p>
          <Link href="/">返回首页</Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <header>
        <h1>🛠️ VanSpend 管理后台</h1>
        <span style={{ flex: 1 }} />
        <span className="meta">
          {user.username} · <Link href="/">返回小票记账</Link> ·{' '}
          <a href="#" onClick={(e) => { e.preventDefault(); handleLogout(); }}>退出</a>
        </span>
      </header>
      <div className="wrap">
        <div className="tabs">
          {TABS.map((t) => (
            <div key={t.key} className={'tab' + (tab === t.key ? ' active' : '')} onClick={() => setTab(t.key)}>{t.label}</div>
          ))}
        </div>
        <section className={'grid' + (tab !== 'stats' ? ' hide' : '')}>
          <StatsPanel active={tab === 'stats'} cfg={cfg} />
        </section>
        <section className={'grid' + (tab !== 'users' ? ' hide' : '')}>
          <UsersPanel active={tab === 'users'} />
        </section>
        <section className={'grid' + (tab !== 'receipts' ? ' hide' : '')}>
          <ReceiptsPanel active={tab === 'receipts'} />
        </section>
        <section className={'grid' + (tab !== 'feedback' ? ' hide' : '')}>
          <FeedbackPanel active={tab === 'feedback'} />
        </section>
        <section className={'grid' + (tab !== 'audit' ? ' hide' : '')}>
          <AuditPanel active={tab === 'audit'} />
        </section>
      </div>
      <Toast />
    </>
  );
}
