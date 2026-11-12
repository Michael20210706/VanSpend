'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { formatDateTime, utcTitle } from '../../lib/time';

export default function FeedbackPanel({ active }) {
  const [rows, setRows] = useState([]);

  async function load() {
    setRows(await api('/api/admin/feedback'));
  }

  useEffect(() => { if (active) load(); }, [active]);

  return (
    <div className="card">
      <h2>用户反馈</h2>
      <div className="table-scroll">
        <table>
          <thead><tr><th>用户</th><th>内容</th><th>时间</th></tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={3} className="empty">暂无反馈</td></tr>
            ) : rows.map((f) => (
              <tr key={f.id}>
                <td>{f.username}</td>
                <td style={{ whiteSpace: 'pre-wrap' }}>{f.content}</td>
                <td title={utcTitle(f.created_at)}>{formatDateTime(f.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
