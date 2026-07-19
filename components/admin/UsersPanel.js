'use client';
import { useEffect, useState } from 'react';
import { api, fmt } from '../../lib/api';
import { showToast } from '../../lib/toast';

export default function UsersPanel({ active }) {
  const [users, setUsers] = useState([]);

  async function load() {
    setUsers(await api('/api/admin/users'));
  }

  useEffect(() => { if (active) load(); }, [active]);

  async function del(id, username) {
    if (!confirm(`确认删除账号「${username}」？其名下所有小票和明细会一并删除，且不可恢复。`)) return;
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
      <div className="table-scroll">
      <table>
        <thead>
          <tr><th>用户名</th><th>角色</th><th>注册时间</th><th className="num">小票数</th><th className="num">累计花费</th><th></th></tr>
        </thead>
        <tbody>
          {users.length === 0 ? (
            <tr><td colSpan={6} className="empty">暂无用户</td></tr>
          ) : users.map((u) => (
            <tr key={u.id}>
              <td>{u.username}</td>
              <td>{u.is_admin ? <span className="badge ok">管理员</span> : <span className="muted">普通用户</span>}</td>
              <td>{u.created_at}</td>
              <td className="num">{u.receipt_count}</td>
              <td className="num">${fmt(u.total_spend)}</td>
              <td><button className="danger" onClick={() => del(u.id, u.username)}>删除</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
