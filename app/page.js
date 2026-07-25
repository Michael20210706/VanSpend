'use client';
import { useCallback, useEffect, useState } from 'react';
import Header from '../components/Header';
import AuthGate from '../components/AuthGate';
import Toast from '../components/Toast';
import ScanTab from '../components/ScanTab';
import DashboardTab from '../components/DashboardTab';
import ReceiptsTab from '../components/ReceiptsTab';
import FamilyPanel from '../components/FamilyPanel';
import { api, setUnauthorizedHandler } from '../lib/api';

const TABS = [
  { key: 'scan', label: '上传识别' },
  { key: 'dash', label: '数据分析' },
  { key: 'list', label: '小票记录' },
  { key: 'family', label: '家庭' },
];

export default function Home() {
  const [user, setUser] = useState(undefined); // undefined=加载中, null=未登录
  const [cfg, setCfg] = useState({ categories: [], currency: 'CAD', model: '', hasKey: false });
  const [tab, setTab] = useState('scan');

  const showAuth = useCallback(() => setUser(null), []);

  useEffect(() => { setUnauthorizedHandler(showAuth); }, [showAuth]);

  useEffect(() => {
    api('/api/auth/me').then(setUser).catch(() => setUser(null));
  }, []);

  useEffect(() => {
    // /api/config 是公开接口，不管有没有登录都请求一次，这样退出登录后头部的 Key 徽章仍能反映真实配置
    api('/api/config').then(setCfg).catch(() => {});
  }, []);

  async function handleLogout() {
    await api('/api/auth/logout', { method: 'POST' });
    setUser(null);
  }

  return (
    <>
      <Header cfg={cfg} user={user} onLogout={handleLogout} />

      {user === undefined ? null : !user ? (
        <div className="wrap" style={{ maxWidth: 380 }}>
          <AuthGate onLoggedIn={setUser} />
        </div>
      ) : (
        <div className="wrap">
          <div className="tabs">
            {TABS.map((t) => (
              <div
                key={t.key}
                className={'tab' + (tab === t.key ? ' active' : '')}
                onClick={() => setTab(t.key)}
              >{t.label}</div>
            ))}
          </div>

          <section className={'grid' + (tab !== 'scan' ? ' hide' : '')}>
            <ScanTab cfg={cfg} />
          </section>
          <section className={'grid' + (tab !== 'dash' ? ' hide' : '')}>
            <DashboardTab cfg={cfg} active={tab === 'dash'} />
          </section>
          <section className={'grid' + (tab !== 'list' ? ' hide' : '')}>
            <ReceiptsTab active={tab === 'list'} showOwner={!!user?.familyId} />
          </section>
          <section className={'grid' + (tab !== 'family' ? ' hide' : '')}>
            <FamilyPanel active={tab === 'family'} />
          </section>
        </div>
      )}

      <Toast />
    </>
  );
}
