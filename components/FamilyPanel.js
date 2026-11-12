'use client';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { showToast } from '../lib/toast';
import { FAMILY_ROLE_LABELS } from '../lib/familyRoles';
import InviteCodes from './InviteCodes';

export default function FamilyPanel({ active, onChanged }) {
  const [data, setData] = useState(undefined); // undefined=加载中, { family: null|{...}, ... }
  const [createName, setCreateName] = useState('');
  const [applyName, setApplyName] = useState('');
  const [createErr, setCreateErr] = useState('');
  const [applyErr, setApplyErr] = useState('');
  const [inviteUsername, setInviteUsername] = useState('');
  const [newName, setNewName] = useState('');
  const [dissolveName, setDissolveName] = useState('');

  async function load() {
    setData(await api('/api/family/me'));
  }

  // 成员关系变了: 重读家庭详情，并让页面重新读一遍用户身份
  async function changed() {
    await load();
    if (onChanged) onChanged();
  }

  const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  async function run(label, fn) {
    try {
      await fn();
      showToast(label + '成功');
      await changed();
    } catch (e) {
      showToast(label + '失败: ' + e.message);
    }
  }

  const leave = () => {
    const alone = data.isCreator && data.members.length === 1;
    const text = alone
      ? '你是这个家庭里唯一的成员，退出会解散这个家庭(家庭名称之后可以重新使用)。你的小票仍归你。确认退出？'
      : '确认退出这个家庭？退出后你自己上传的小票会跟着你走，其他成员将看不到它们。';
    if (!confirm(text)) return;
    run('退出', () => api('/api/family/leave', { method: 'POST' }));
  };
  const removeMember = (m) => {
    if (!confirm(`确认把「${m.username}」移出家庭？他上传的小票会跟着他走，家庭里将看不到。`)) return;
    run('移除', () => api('/api/family/members/' + m.id, { method: 'DELETE' }));
  };
  const transfer = (m) => {
    if (!confirm(`确认把创建者身份转让给「${m.username}」？转让后你将不能再邀请/审核/移除成员，也不能解散或改名。`)) return;
    run('转让', () => api('/api/family/transfer', json({ userId: m.id })));
  };
  const rename = () => {
    if (!newName.trim()) return;
    run('改名', () => api('/api/family', { ...json({ name: newName.trim() }), method: 'PATCH' }).then(() => setNewName('')));
  };
  const dissolve = () => {
    run('解散', () => api('/api/family/dissolve', json({ name: dissolveName })).then(() => setDissolveName('')));
  };
  const withdraw = (id) => run('撤回申请', () => api('/api/family/applications/' + id, { method: 'DELETE' }));

  useEffect(() => { if (active) load(); }, [active]);

  async function createFamily() {
    if (!createName.trim()) { setCreateErr('请输入家庭名称'); return; }
    setCreateErr('');
    try {
      await api('/api/family', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: createName.trim() }) });
      showToast('家庭已创建');
      setCreateName('');
      changed();
    } catch (e) {
      showToast('创建失败: ' + e.message);
    }
  }

  async function applyFamily() {
    if (!applyName.trim()) { setApplyErr('请输入要加入的家庭名称'); return; }
    setApplyErr('');
    try {
      await api('/api/family/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: applyName.trim() }) });
      showToast('已提交申请，等待创建者审核');
      setApplyName('');
      load();
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
            <input placeholder="家庭名称" maxLength={100} value={createName} onChange={(e) => { setCreateName(e.target.value); setCreateErr(''); }} />
            <button onClick={createFamily}>创建</button>
            <span style={{ color: 'var(--bad)', fontSize: 13 }}>{createErr}</span>
          </div>
        </div>
        <div className="card">
          <h2>申请加入已有家庭</h2>
          <p className="muted">提交后需等待该家庭的创建者审核通过才会生效。</p>
          <div className="row">
            <input placeholder="要加入的家庭名称" maxLength={100} value={applyName} onChange={(e) => { setApplyName(e.target.value); setApplyErr(''); }} />
            <button onClick={applyFamily}>申请加入</button>
            <span style={{ color: 'var(--bad)', fontSize: 13 }}>{applyErr}</span>
          </div>
        </div>
        {data.myApplications && data.myApplications.length > 0 && (
          <div className="card">
            <h2>我的申请</h2>
            <div className="table-scroll">
              <table>
                <thead><tr><th>家庭</th><th>申请时间</th><th></th></tr></thead>
                <tbody>
                  {data.myApplications.map((a) => (
                    <tr key={a.id}>
                      <td>{a.family_name}</td>
                      <td>{a.created_at}</td>
                      <td><button className="danger" onClick={() => withdraw(a.id)}>撤回</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
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
            <thead><tr><th>成员</th><th>角色</th><th>加入时间</th>{data.isCreator ? <th></th> : null}</tr></thead>
            <tbody>
              {data.members.map((m) => (
                <tr key={m.id}>
                  <td>{m.username}</td>
                  <td>{FAMILY_ROLE_LABELS[m.family_role] || '-'}</td>
                  <td>{m.created_at}</td>
                  {data.isCreator ? (
                    <td>
                      {m.id === data.userId ? <span className="muted">创建者(你)</span> : (
                        <>
                          <button onClick={() => transfer(m)}>设为创建者</button>
                          <button className="danger" onClick={() => removeMember(m)}>移除</button>
                        </>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>家庭设置</h2>
        <div className="row">
          <button className="danger" onClick={leave}>退出家庭</button>
          <span className="muted">
            {data.isCreator
              ? '你是创建者：还有其他成员时请先转让创建者身份；只剩你一人时退出就是解散家庭。'
              : '退出后，你上传的小票会跟着你走。'}
          </span>
        </div>
        {data.isCreator && (
          <>
            <div className="row" style={{ marginTop: 12 }}>
              <input placeholder="新的家庭名称" maxLength={100} value={newName} onChange={(e) => setNewName(e.target.value)} />
              <button onClick={rename}>改名</button>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <input
                placeholder={`输入「${data.family.name}」确认解散`}
                value={dissolveName}
                onChange={(e) => setDissolveName(e.target.value)}
              />
              <button className="danger" disabled={dissolveName !== data.family.name} onClick={dissolve}>解散家庭</button>
            </div>
            <p className="muted" style={{ margin: '8px 0 0' }}>解散后所有成员变回个人账号，每个人的小票仍归各自所有；待审申请和家庭邀请码会被清除。</p>
          </>
        )}
      </div>

      {data.isCreator && (
        <>
          <div className="card">
            <h2>邀请成员</h2>
            <p className="muted">直接输入一个已注册且尚未加入任何家庭的用户名，立即生效。</p>
            <div className="row">
              <input placeholder="用户名" maxLength={100} value={inviteUsername} onChange={(e) => setInviteUsername(e.target.value)} />
              <button onClick={invite}>邀请</button>
            </div>
          </div>
          <div className="card">
            <h2>家庭邀请码</h2>
            <InviteCodes kind="family" />
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
