'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

const ACTION_LABELS = {
  delete_user: '删除用户',
  delete_receipt: '删除小票',
  reset_password: '重置密码',
  set_tier: '调整额度',
};

// 管理员操作日志: 只读，最新在前。只记录写操作(不记录查看)，没有修改或删除日志的入口。
export default function AuditPanel({ active }) {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    if (active) api('/api/admin/audit').then(setRows).catch(() => {});
  }, [active]);

  return (
    <div className="card">
      <h2>操作日志</h2>
      <p className="muted" style={{ marginTop: 0 }}>记录管理员的写操作(删除用户/小票、重置密码、调整额度)，不记录查看；只读，最近 200 条。</p>
      <div className="table-scroll">
        <table>
          <thead><tr><th>时间</th><th>操作人</th><th>操作</th><th>对象</th><th>说明</th></tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="empty">暂无记录</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id}>
                <td>{r.created_at}</td>
                <td>{r.admin_username}</td>
                <td>{ACTION_LABELS[r.action] || r.action}</td>
                <td>{r.target_type === 'user' ? '用户' : '小票'} #{r.target_id} · {r.target_label}</td>
                <td className="muted">{r.detail || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
