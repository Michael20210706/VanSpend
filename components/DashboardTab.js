'use client';
import { useEffect, useState } from 'react';
import {
  Chart as ChartJS,
  ArcElement,
  BarElement,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
} from 'chart.js';
import { Doughnut, Bar, Line } from 'react-chartjs-2';
import { api, fmt } from '../lib/api';
import { showToast } from '../lib/toast';
import { computePresetRange, PRESETS } from '../lib/dateRange';

ChartJS.register(ArcElement, BarElement, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend);

// 分类色板: 8 个已校验(CVD/对比度)色相，按固定顺序分配，不做无依据的新色生成；
// 超过 8 个系列时复用色相但降低不透明度，弱化"长尾"分类而不是伪造新颜色
const SERIES = ['#3987e5', '#199e70', '#c98500', '#008300', '#9085e9', '#e66767', '#d55181', '#d95926'];
function seriesColors(n) {
  return Array.from({ length: n }, (_, i) => (i < SERIES.length ? SERIES[i] : SERIES[i % SERIES.length] + '66'));
}
const CHART_GAP = '#17202d'; // 卡片背景色，用作分段/环形图之间的 2px 间隔描边
const baseOptions = { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#e6edf3' } } } };
const axisTicks = { ticks: { color: '#8b98a9' }, grid: { color: '#2a3548' } };

function rangeQS(from, to) {
  const q = [];
  if (from) q.push('from=' + from);
  if (to) q.push('to=' + to);
  return q.length ? '?' + q.join('&') : '';
}

export default function DashboardTab({ cfg, active }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [kpis, setKpis] = useState(null);
  const [catData, setCatData] = useState([]);
  const [subData, setSubData] = useState([]);
  const [monData, setMonData] = useState([]);
  const [names, setNames] = useState([]);
  const [subCategory, setSubCategory] = useState('肉类');
  const [trendName, setTrendName] = useState('');
  const [trendStore, setTrendStore] = useState('');
  const [trendData, setTrendData] = useState(null); // null = 尚未查询过

  async function loadSub(f, t, cat) {
    const qs = rangeQS(f, t);
    const sep = qs ? '&' : '?';
    const d = await api('/api/stats/subcategory' + qs + sep + 'category=' + encodeURIComponent(cat));
    setSubData(d);
  }

  async function loadAll(f = from, t = to) {
    const qs = rangeQS(f, t);
    setKpis(await api('/api/stats/overview' + qs));
    setCatData(await api('/api/stats/category' + qs));
    await loadSub(f, t, subCategory);
    setMonData(await api('/api/stats/monthly' + qs));
    setNames(await api('/api/items/names'));
  }

  useEffect(() => { if (active) loadAll(); }, [active]);

  function applyRange() { loadAll(); }
  function clearRange() { setFrom(''); setTo(''); loadAll('', ''); }
  function applyPreset(kind) {
    const r = computePresetRange(kind);
    if (!r) return;
    setFrom(r[0]); setTo(r[1]);
    loadAll(r[0], r[1]);
  }
  function onSubCategoryChange(cat) {
    setSubCategory(cat);
    loadSub(from, to, cat);
  }

  async function runTrend() {
    const name = trendName.trim();
    if (!name) { showToast('请输入品名'); return; }
    const store = trendStore.trim();
    const d = await api('/api/stats/trend?name=' + encodeURIComponent(name) + (store ? '&store=' + encodeURIComponent(store) : ''));
    if (!d.length) showToast('没有匹配记录');
    setTrendData(d);
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

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="card">
          <h2>各分类花费占比</h2>
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
              {cfg.categories.map((c) => <option key={c}>{c}</option>)}
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

      <div className="card">
        <h2>月度花费与税额</h2>
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
        <h2>价格趋势</h2>
        <div className="row" style={{ marginBottom: 12 }}>
          <input list="nameList" placeholder="输入品名，如 牛肉 / 三文鱼" style={{ width: 220 }} value={trendName} onChange={(e) => setTrendName(e.target.value)} />
          <datalist id="nameList">{names.map((x) => <option key={x.name} value={x.name} />)}</datalist>
          <input placeholder="商家(可选)" style={{ width: 140 }} value={trendStore} onChange={(e) => setTrendStore(e.target.value)} />
          <button onClick={runTrend}>查询</button>
        </div>
        <div className="chartbox">
          {trendData !== null && (
            <Line
              data={{
                labels: trendData.map((x) => x.date),
                datasets: [{
                  label: trendName + ' 单价 $', data: trendData.map((x) => x.unit_price),
                  borderColor: SERIES[0], backgroundColor: '#3987e533', pointBackgroundColor: SERIES[0],
                  borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, tension: 0.25, fill: true,
                }],
              }}
              options={{ ...baseOptions, scales: { x: axisTicks, y: axisTicks } }}
            />
          )}
        </div>
        {trendData !== null && (
          <table>
            <thead><tr><th>日期</th><th>商家</th><th>品名</th><th className="num">数量</th><th className="num">单价</th><th className="num">金额</th></tr></thead>
            <tbody>
              {trendData.map((x, i) => (
                <tr key={i}>
                  <td>{x.date}</td><td>{x.store}</td><td>{x.name}</td>
                  <td className="num">{x.qty ?? '-'}</td><td className="num">{fmt(x.unit_price)}</td><td className="num">{fmt(x.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
