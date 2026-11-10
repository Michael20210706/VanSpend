'use client';
import { useCallback, useEffect, useState } from 'react';
import Header from '../components/Header';
import Landing from '../components/landing/Landing';
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

  useEffect(() => setUnauthorizedHandler(showAuth), [showAuth]);

  useEffect(() => {
    api('/api/auth/me').then(setUser).catch(() => setUser(null));
  }, []);

  useEffect(() => {
    // 只有登录后才需要 cfg(分类下拉、头部的 Key 徽章和模型名)；未登录时渲染的是落地页，
    // 不该把 .env 的配置状态透给匿名访客
    if (user) api('/api/config').then(setCfg).catch(() => {});
  }, [user]);

  // 家庭成员关系变了(创建/退出/移除/解散/被转让…)之后，重新读一遍身份: Header、"小票记录"里是否显示所有者列等都依赖 user.familyId
  const refreshUser = useCallback(() => {
    api('/api/auth/me').then(setUser).catch(() => {});
  }, []);

  async function handleLogout() {
    await api('/api/auth/logout', { method: 'POST' });
    setUser(null);
  }

  if (user === undefined) return null; // 等 /api/auth/me 落地，避免落地页和应用互闪
  if (!user) return <Landing />; // 未登录 = 宣传落地页；它自带导航和页脚，不挂 Header

  return (
    <>
      <Header cfg={cfg} user={user} onLogout={handleLogout} />

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
          <ReceiptsTab active={tab === 'list'} showOwner={!!user?.familyId} userId={user?.id} cfg={cfg} />
        </section>
        <section className={'grid' + (tab !== 'family' ? ' hide' : '')}>
          <FamilyPanel active={tab === 'family'} onChanged={refreshUser} />
        </section>
      </div>

      <Toast />
    </>
  );
}
