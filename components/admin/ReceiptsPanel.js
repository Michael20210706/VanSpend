'use client';
import { useEffect, useRef, useState } from 'react';
import { api, fmt } from '../../lib/api';
import { computePresetRange, PRESETS } from '../../lib/dateRange';

function query(from, to, search, userId) {
  const q = [];
  if (from) q.push('from=' + from);
  if (to) q.push('to=' + to);
  if (search) q.push('search=' + encodeURIComponent(search));
  if (userId) q.push('userId=' + userId);
  return q.length ? '?' + q.join('&') : '';
}

export default function ReceiptsPanel({ active }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [userId, setUserId] = useState('');
  const [users, setUsers] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [detail, setDetail] = useState(null);
  const detailRef = useRef(null);

  async function load(f = from, t = to, s = search, uid = userId) {
    setReceipts(await api('/api/admin/receipts' + query(f, t, s, uid)));
  }

  useEffect(() => {
    if (!active) return;
    api('/api/admin/users').then(setUsers);
    load();
  }, [active]);

  useEffect(() => { if (detail && detailRef.current) detailRef.current.scrollIntoView({ behavior: 'smooth' }); }, [detail]);

  function applyPreset(kind) {
    const r = computePresetRange(kind);
    if (!r) return;
    setFrom(r[0]); setTo(r[1]);
    load(r[0], r[1], search, userId);
  }
  function clearFilters() {
    setFrom(''); setTo(''); setSearch(''); setUserId('');
    load('', '', '', '');
  }
  function onUserChange(uid) {
    setUserId(uid);
    load(from, to, search, uid);
  }

  async function viewRec(id) {
    setDetail(await api('/api/admin/receipts/' + id));
  }
  async function delRec(id) {
    if (!confirm('确认删除这张小票？')) return;
    await api('/api/admin/receipts/' + id, { method: 'DELETE' });
    load();
    setDetail(null);
  }

  return (
    <>
      <div className="card">
        <h2>票据管理(全部用户)</h2>
        <div className="row" style={{ marginBottom: 10 }}>
          <label>从 <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>到 <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <input
            placeholder="搜索商家或品名" style={{ width: 200 }} value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') load(); }}
          />
          <select value={userId} onChange={(e) => onUserChange(e.target.value)}>
            <option value="">全部用户</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
          </select>
          <button onClick={() => load()}>筛选</button>
          <button className="ghost" onClick={clearFilters}>清除</button>
        </div>
        <div className="row" style={{ marginBottom: 14 }}>
          {PRESETS.map((p) => <button key={p.key} className="ghost" onClick={() => applyPreset(p.key)}>{p.label}</button>)}
        </div>
        <div className="table-scroll">
        <table>
          <thead>
            <tr><th>日期</th><th>用户</th><th>商家</th><th className="num">税前</th><th className="num">GST</th><th className="num">PST</th><th className="num">实付</th><th className="num">条目</th><th></th></tr>
          </thead>
          <tbody>
            {receipts.length === 0 ? (
              <tr><td colSpan={9} className="empty">暂无记录</td></tr>
            ) : receipts.map((r) => (
              <tr key={r.id}>
                <td>{r.purchased_at}</td><td>{r.owner_username || '-'}</td><td>{r.store}</td>
                <td className="num">{fmt(r.subtotal)}</td><td className="num">{fmt(r.gst)}</td><td className="num">{fmt(r.pst)}</td>
                <td className="num">{fmt(r.total)}</td><td className="num">{r.item_count}</td>
                <td>
                  <button className="ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => viewRec(r.id)}>明细</button>
                  <button className="danger" onClick={() => delRec(r.id)}>删</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {detail && (
        <div className="card" ref={detailRef}>
          <h2>{detail.store} · {detail.purchased_at} · <span className="muted">{detail.owner_username}</span></h2>
          <p className="muted">税前 ${fmt(detail.subtotal)} ｜ GST ${fmt(detail.gst)} ｜ PST ${fmt(detail.pst)} ｜ 实付 ${fmt(detail.total)}</p>
          {detail.image_file && (
            <img src={'/uploads/' + detail.image_file} className="receipt-image" alt="" />
          )}
          <div className="table-scroll">
          <table>
            <thead><tr><th>品名</th><th>分类</th><th>细分</th><th className="num">数量</th><th className="num">单价</th><th className="num">金额</th><th>税</th></tr></thead>
            <tbody>
              {detail.items.map((i) => (
                <tr key={i.id}>
                  <td>{i.name_raw}{i.name_norm && i.name_norm !== i.name_raw ? <span className="muted"> ({i.name_norm})</span> : null}</td>
                  <td>{i.category}</td><td>{i.subcategory || '-'}</td>
                  <td className="num">{i.qty}</td><td className="num">{fmt(i.unit_price)}</td><td className="num">{fmt(i.amount)}</td>
                  <td style={{ textAlign: 'center' }}>{i.taxable ? '✓' : ''}</td>
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
