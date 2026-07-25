'use client';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { showToast } from '../lib/toast';
import { FAMILY_ROLE_LABELS } from '../lib/familyRoles';

export default function FamilyPanel({ active }) {
  const [data, setData] = useState(undefined); // undefined=加载中, { family: null|{...}, ... }
  const [createName, setCreateName] = useState('');
  const [applyName, setApplyName] = useState('');
  const [inviteUsername, setInviteUsername] = useState('');

  async function load() {
    setData(await api('/api/family/me'));
  }

  useEffect(() => { if (active) load(); }, [active]);

  async function createFamily() {
    if (!createName.trim()) return;
    try {
      await api('/api/family', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: createName.trim() }) });
      showToast('家庭已创建');
      setCreateName('');
      load();
    } catch (e) {
      showToast('创建失败: ' + e.message);
    }
  }

  async function applyFamily() {
    if (!applyName.trim()) return;
    try {
      await api('/api/family/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: applyName.trim() }) });
      showToast('已提交申请，等待创建者审核');
      setApplyName('');
    } catch (e) {
      showToast('申请失败: ' + e.message);
    }
  }

  async function invite() {
    if (!inviteUsername.trim()) return;
    try {
      await api('/api/family/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: inviteUsername.trim() }) });
      showToast('已邀请加入');
      setInviteUsername('');
      load();
    } catch (e) {
      showToast('邀请失败: ' + e.message);
    }
  }

  async function decide(id, decision) {
    try {
      await api('/api/family/requests/' + id, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }) });
      load();
    } catch (e) {
      showToast('操作失败: ' + e.message);
    }
  }

  if (data === undefined) return null;

  if (!data.family) {
    return (
      <>
        <div className="card">
          <h2>创建新家庭</h2>
          <p className="muted">家庭名称需在全站唯一；创建后你就是该家庭的创建者，可以邀请成员、审核加入申请。</p>
          <div className="row">
            <input placeholder="家庭名称" value={createName} onChange={(e) => setCreateName(e.target.value)} />
            <button onClick={createFamily}>创建</button>
          </div>
        </div>
        <div className="card">
          <h2>申请加入已有家庭</h2>
          <p className="muted">提交后需等待该家庭的创建者审核通过才会生效。</p>
          <div className="row">
            <input placeholder="要加入的家庭名称" value={applyName} onChange={(e) => setApplyName(e.target.value)} />
            <button onClick={applyFamily}>申请加入</button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="card">
        <h2>{data.family.name}</h2>
        <p className="muted">
          我的角色: {FAMILY_ROLE_LABELS[data.role] || '未设置'}
          {data.isCreator ? <span className="badge ok" style={{ marginLeft: 8 }}>创建者</span> : null}
        </p>
        <div className="table-scroll">
          <table>
            <thead><tr><th>成员</th><th>角色</th><th>加入时间</th></tr></thead>
            <tbody>
              {data.members.map((m) => (
                <tr key={m.id}>
                  <td>{m.username}</td>
                  <td>{FAMILY_ROLE_LABELS[m.family_role] || '-'}</td>
                  <td>{m.created_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {data.isCreator && (
        <>
          <div className="card">
            <h2>邀请成员</h2>
            <p className="muted">直接输入一个已注册且尚未加入任何家庭的用户名，立即生效。</p>
            <div className="row">
              <input placeholder="用户名" value={inviteUsername} onChange={(e) => setInviteUsername(e.target.value)} />
              <button onClick={invite}>邀请</button>
            </div>
          </div>
          <div className="card">
            <h2>待审核申请</h2>
            <div className="table-scroll">
              <table>
                <thead><tr><th>用户</th><th>申请时间</th><th></th></tr></thead>
                <tbody>
                  {data.pendingRequests.length === 0 ? (
                    <tr><td colSpan={3} className="empty">暂无待审核申请</td></tr>
                  ) : data.pendingRequests.map((r) => (
                    <tr key={r.id}>
                      <td>{r.username}</td>
                      <td>{r.created_at}</td>
                      <td>
                        <button onClick={() => decide(r.id, 'approve')}>通过</button>
                        <button className="danger" onClick={() => decide(r.id, 'reject')}>拒绝</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
