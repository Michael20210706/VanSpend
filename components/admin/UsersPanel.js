'use client';
import { useEffect, useState } from 'react';
import { api, fmt } from '../../lib/api';
import { showToast } from '../../lib/toast';
import { FAMILY_ROLE_LABELS } from '../../lib/familyRoles';

export default function UsersPanel({ active, currentUserId }) {
  const [users, setUsers] = useState([]);
  const [resetResult, setResetResult] = useState(null); // { username, password }: 临时密码只在这里显示一次

  async function load() {
    setUsers(await api('/api/admin/users'));
  }

  useEffect(() => { if (active) load(); }, [active]);

  async function setTier(id, username, tier) {
    const label = tier === 'normal' ? '正常额度' : '开放注册额度(较低)';
    if (!confirm(`把「${username}」的每日识别额度调整为${label}？`)) return;
    try {
      await api('/api/admin/users/' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier }),
      });
      showToast('已更新');
      load();
    } catch (e) {
      showToast('更新失败: ' + e.message);
    }
  }

  async function resetPassword(id, username) {
    if (!confirm(`把「${username}」的密码重置成临时密码？他下次登录必须先修改；原密码立即失效。`)) return;
    try {
      const r = await api('/api/admin/users/' + id + '/reset-password', { method: 'POST' });
      setResetResult({ username, password: r.temporaryPassword });
    } catch (e) {
      showToast('重置失败: ' + e.message);
    }
  }

  async function del(id, username, isFamilyCreator, familyName) {
    const dissolve = isFamilyCreator ? `他是家庭「${familyName}」的创建者，删除后该家庭会解散，其他成员变回个人账号。` : '';
    if (!confirm(`确认删除账号「${username}」？${dissolve}其名下所有小票和明细会一并删除，且不可恢复。`)) return;
    try {
      await api('/api/admin/users/' + id, { method: 'DELETE' });
      showToast('已删除');
      load();
    } catch (e) {
      showToast('删除失败: ' + e.message);
    }
  }

  return (
    <div className="card">
      <h2>用户管理</h2>
      {resetResult && (
        <div className="card" style={{ border: '1px solid var(--acc)' }}>
          <p style={{ margin: 0 }}>
            「{resetResult.username}」的临时密码: <code style={{ fontSize: 16 }}>{resetResult.password}</code>
          </p>
          <p className="muted" style={{ margin: '6px 0 10px' }}>只显示这一次，请自己转告用户(这里关闭后无法再查看)。用户登录后会被要求先设置新密码。</p>
          <button onClick={() => setResetResult(null)}>我已记下，关闭</button>
        </div>
      )}
      <div className="table-scroll">
      <table>
        <thead>
          <tr><th>用户名</th><th>角色</th><th>家庭角色</th><th>所属家庭</th><th>注册来源</th><th>识别额度</th><th>注册时间</th><th className="num">小票数</th><th className="num">累计花费</th><th></th></tr>
        </thead>
        <tbody>
          {users.length === 0 ? (
            <tr><td colSpan={10} className="empty">暂无用户</td></tr>
          ) : users.map((u) => (
            <tr key={u.id}>
              <td>{u.username}</td>
              <td>{u.is_admin ? <span className="badge ok">管理员</span> : <span className="muted">普通用户</span>}</td>
              <td>{FAMILY_ROLE_LABELS[u.family_role] || '-'}</td>
              <td>{u.family_name || '-'}</td>
              <td>
                {u.signup_source === 'open' ? '开放注册' : '邀请注册'}
                {u.inviter_username ? <span className="muted"> · {u.inviter_username}</span> : null}
              </td>
              <td>
                {u.is_admin ? <span className="muted">不限</span> : u.scan_tier === 'open' ? (
                  <>
                    <span className="badge no">较低</span>{' '}
                    <button onClick={() => setTier(u.id, u.username, 'normal')}>升级</button>
                  </>
                ) : (
                  <>
                    <span className="badge ok">正常</span>{' '}
                    <button onClick={() => setTier(u.id, u.username, 'open')}>降级</button>
                  </>
                )}
              </td>
              <td>{u.created_at}</td>
              <td className="num">{u.receipt_count}</td>
              <td className="num">${fmt(u.total_spend)}</td>
              <td>
                {u.is_admin ? null : <button onClick={() => resetPassword(u.id, u.username)}>重置密码</button>}{' '}
                {u.id === currentUserId ? null : <button className="danger" onClick={() => del(u.id, u.username, !!u.is_family_creator, u.family_name)}>删除</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
