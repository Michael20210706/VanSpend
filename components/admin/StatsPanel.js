'use client';
import { useEffect, useState } from 'react';
import {
  Chart as ChartJS,
  ArcElement,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
} from 'chart.js';
import { Doughnut, Bar } from 'react-chartjs-2';
import { api, fmt } from '../../lib/api';
import { computePresetRange, PRESETS } from '../../lib/dateRange';

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

const SERIES = ['#3987e5', '#199e70', '#c98500', '#008300', '#9085e9', '#e66767', '#d55181', '#d95926'];
function seriesColors(n) {
  return Array.from({ length: n }, (_, i) => (i < SERIES.length ? SERIES[i] : SERIES[i % SERIES.length] + '66'));
}
const CHART_GAP = '#17202d';
const baseOptions = { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#e6edf3' } } } };
const axisTicks = { ticks: { color: '#8b98a9' }, grid: { color: '#2a3548' } };

function rangeQS(from, to, userId) {
  const q = [];
  if (from) q.push('from=' + from);
  if (to) q.push('to=' + to);
  if (userId) q.push('userId=' + userId);
  return q.length ? '?' + q.join('&') : '';
}

export default function StatsPanel({ active, cfg }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [userId, setUserId] = useState(''); // 空 = 全部用户
  const [users, setUsers] = useState([]);
  const [kpis, setKpis] = useState(null);
  const [catData, setCatData] = useState([]);
  const [subData, setSubData] = useState([]);
  const [monData, setMonData] = useState([]);
  const [byUserData, setByUserData] = useState([]);
  const [subCategory, setSubCategory] = useState('肉类');

  async function loadSub(f, t, uid, cat) {
    const qs = rangeQS(f, t, uid);
    const sep = qs ? '&' : '?';
    setSubData(await api('/api/admin/stats/subcategory' + qs + sep + 'category=' + encodeURIComponent(cat)));
  }

  async function loadAll(f = from, t = to, uid = userId) {
    const qs = rangeQS(f, t, uid);
    setKpis(await api('/api/admin/stats/overview' + qs));
    setCatData(await api('/api/admin/stats/category' + qs));
    await loadSub(f, t, uid, subCategory);
    setMonData(await api('/api/admin/stats/monthly' + qs));
    setByUserData(await api('/api/admin/stats/by-user' + rangeQS(f, t)));
  }

  useEffect(() => {
    if (!active) return;
    api('/api/admin/users').then(setUsers);
    loadAll();
  }, [active]);

  function applyRange() { loadAll(); }
  function clearRange() { setFrom(''); setTo(''); loadAll('', '', userId); }
  function applyPreset(kind) {
    const r = computePresetRange(kind);
    if (!r) return;
    setFrom(r[0]); setTo(r[1]);
    loadAll(r[0], r[1], userId);
  }
  function onUserChange(uid) {
    setUserId(uid);
    loadAll(from, to, uid);
  }
  function onSubCategoryChange(cat) {
    setSubCategory(cat);
    loadSub(from, to, userId, cat);
  }

  const kpiItems = kpis ? [
    ['实付总额', '$' + fmt(kpis.total)],
    ['税额合计', '$' + fmt(kpis.tax)],
    ['GST', '$' + fmt(kpis.gst)],
    ['PST', '$' + fmt(kpis.pst)],
    ['小票数', kpis.receipts || 0],
    ['商品条目', kpis.lines || 0],
  ] : [];

  return (
    <>
      <div className="card">
        <div className="row">
          <label>从 <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>到 <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <select value={userId} onChange={(e) => onUserChange(e.target.value)}>
            <option value="">全部用户</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
          </select>
          <button onClick={applyRange}>应用</button>
          <button className="ghost" onClick={clearRange}>全部时间</button>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          {PRESETS.map((p) => <button key={p.key} className="ghost" onClick={() => applyPreset(p.key)}>{p.label}</button>)}
        </div>
      </div>

      <div className="cards4">
        {kpiItems.map(([l, v]) => (
          <div className="kpi" key={l}><div className="v">{v}</div><div className="l">{l}</div></div>
        ))}
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <div className="card">
          <h2>各分类花费占比{userId ? '' : '(全部用户)'}</h2>
          <div className="chartbox">
            <Doughnut
              data={{
                labels: catData.map((x) => x.label),
                datasets: [{ data: catData.map((x) => x.amount), backgroundColor: seriesColors(catData.length), borderColor: CHART_GAP, borderWidth: 2 }],
              }}
              options={baseOptions}
            />
          </div>
        </div>
        <div className="card">
          <h2>细分花费{' '}
            <select style={{ marginLeft: 8 }} value={subCategory} onChange={(e) => onSubCategoryChange(e.target.value)}>
              {(cfg.categories || []).map((c) => <option key={c}>{c}</option>)}
            </select>
          </h2>
          <div className="chartbox">
            <Bar
              data={{
                labels: subData.map((x) => x.label),
                datasets: [{ label: '花费 $', data: subData.map((x) => x.amount), backgroundColor: SERIES[0], borderRadius: 4, maxBarThickness: 48 }],
              }}
              options={{ ...baseOptions, scales: { x: axisTicks, y: axisTicks } }}
            />
          </div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <div className="card">
          <h2>月度花费与税额{userId ? '' : '(全部用户)'}</h2>
          <div className="chartbox">
            <Bar
              data={{
                labels: monData.map((x) => x.month),
                datasets: [
                  { label: '税前', data: monData.map((x) => x.subtotal), backgroundColor: SERIES[0], stack: 's', borderColor: CHART_GAP, borderWidth: 2 },
                  { label: 'GST', data: monData.map((x) => x.gst), backgroundColor: SERIES[2], stack: 's', borderColor: CHART_GAP, borderWidth: 2 },
                  { label: 'PST', data: monData.map((x) => x.pst), backgroundColor: SERIES[5], stack: 's', borderColor: CHART_GAP, borderWidth: 2 },
                ],
              }}
              options={{ ...baseOptions, scales: { x: { ...axisTicks, stacked: true }, y: { ...axisTicks, stacked: true } } }}
            />
          </div>
        </div>
        <div className="card">
          <h2>各用户花费排行</h2>
          <div className="chartbox">
            <Bar
              data={{
                labels: byUserData.map((x) => x.username),
                datasets: [{ label: '花费 $', data: byUserData.map((x) => x.total), backgroundColor: SERIES[0], borderRadius: 4, maxBarThickness: 48 }],
              }}
              options={{ ...baseOptions, scales: { x: axisTicks, y: axisTicks } }}
            />
          </div>
        </div>
      </div>
    </>
  );
}
