'use client';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { showToast } from '../lib/toast';
import { formatDateTime, utcTitle } from '../lib/time';

const STATUS_LABEL = { unused: '未使用', used: '已使用', revoked: '已作废', expired: '已过期' };

// 邀请码的生成 / 查看 / 作废。kind='personal': 普通邀请码(只管注册)；kind='family': 入家庭邀请码(仅家庭创建者，
// 注册后直接加入自己的家庭)。两个入口共用这一个组件，只是请求的 kind 不同。
export default function InviteCodes({ kind = 'personal' }) {
  const [codes, setCodes] = useState(null);
  const isFamily = kind === 'family';

  async function load() {
    try {
      setCodes(await api('/api/invites?kind=' + kind));
    } catch (e) {
      showToast('加载邀请码失败: ' + e.message);
      setCodes([]);
    }
  }

  useEffect(() => { load(); }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps

  async function generate() {
    try {
      await api('/api/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ family: isFamily }),
      });
      load();
    } catch (e) {
      showToast('生成失败: ' + e.message);
    }
  }

  async function revoke(id) {
    if (!confirm('作废后这个邀请码就不能再用了，确认作废？')) return;
    try {
      await api('/api/invites/' + id, { method: 'DELETE' });
      load();
    } catch (e) {
      showToast('作废失败: ' + e.message);
    }
  }

  // 复制的是一条带邀请码的注册链接，对方打开后邀请码已经填好
  async function copyLink(code) {
    const link = `${window.location.origin}/login?mode=register&code=${encodeURIComponent(code)}`;
    try {
      await navigator.clipboard.writeText(link);
      showToast('邀请链接已复制');
    } catch {
      window.prompt('复制这条邀请链接:', link); // 剪贴板不可用(如非 HTTPS)时退而求其次
    }
  }

  return (
    <div>
      <p className="muted" style={{ margin: '0 0 10px' }}>
        {isFamily
          ? '对方用这个码注册后直接加入你的家庭，不用再审核。每个码只能用一次，7 天内有效，每人 7 天最多生成 20 个。'
          : '把邀请链接发给家人朋友，对方不用验证码就能注册，且有更高的每日识别额度。每个码只能用一次，7 天内有效，每人 7 天最多生成 20 个。开放注册的账号暂时不能生成邀请码，需要先由管理员升级额度。'}
      </p>
      <div className="row" style={{ marginBottom: 10 }}>
        <button onClick={generate}>{isFamily ? '生成家庭邀请码' : '生成邀请码'}</button>
      </div>
      <div className="table-scroll">
        <table>
          <thead><tr><th>邀请码</th><th>状态</th><th>有效期至</th><th></th></tr></thead>
          <tbody>
            {codes === null ? (
              <tr><td colSpan={4} className="empty">加载中…</td></tr>
            ) : codes.length === 0 ? (
              <tr><td colSpan={4} className="empty">还没有邀请码</td></tr>
            ) : codes.map((c) => (
              <tr key={c.id}>
                <td style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>{c.code}</td>
                <td>
                  {STATUS_LABEL[c.status]}
                  {c.status === 'used' && c.used_by_username ? <span className="muted"> · {c.used_by_username}</span> : null}
                </td>
                <td title={utcTitle(c.expires_at)}>{formatDateTime(c.expires_at)}</td>
                <td>
                  {c.status === 'unused' ? (
                    <>
                      <button onClick={() => copyLink(c.code)}>复制链接</button>
                      <button className="danger" onClick={() => revoke(c.id)}>作废</button>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
