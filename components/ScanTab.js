'use client';
import { useRef, useState } from 'react';
import { api } from '../lib/api';
import { showToast } from '../lib/toast';

let rowSeq = 0;
function makeRow(it = {}, defaultCategory = '') {
  return {
    _id: ++rowSeq,
    name_raw: it.name_raw || '',
    name_norm: it.name_norm || '',
    category: it.category || defaultCategory,
    subcategory: it.subcategory || '',
    qty: it.qty ?? 1,
    unit: it.unit || '',
    unit_price: it.unit_price ?? '',
    amount: it.amount ?? 0,
    taxable: !!it.taxable,
  };
}

export default function ScanTab({ cfg }) {
  const [currentImage, setCurrentImage] = useState(null);
  const [dragHover, setDragHover] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanHint, setScanHint] = useState('');
  const [editVisible, setEditVisible] = useState(false);
  const [store, setStore] = useState('');
  const [date, setDate] = useState('');
  const [subtotal, setSubtotal] = useState(0);
  const [gst, setGst] = useState(0);
  const [pst, setPst] = useState(0);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState([]);
  const lastRawRef = useRef(null);
  const fileInputRef = useRef(null);

  function readImage(file) {
    const r = new FileReader();
    r.onload = () => setCurrentImage(r.result);
    r.readAsDataURL(file);
  }

  async function scan() {
    if (!currentImage) return;
    setScanning(true);
    setScanHint('AI 识别中，请稍候…');
    try {
      const { receipt, items, raw } = await api('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: currentImage }),
      });
      lastRawRef.current = raw;
      setEditVisible(true);
      setStore(receipt.store || '');
      setDate(receipt.purchased_at || '');
      setSubtotal(receipt.subtotal || 0);
      setGst(receipt.gst || 0);
      setPst(receipt.pst || 0);
      setTotal(receipt.total || 0);
      setRows(items.map((it) => makeRow(it)));
      setScanHint('识别完成，请核对');
    } catch (e) {
      setScanHint('');
      showToast('识别失败: ' + e.message);
    }
    setScanning(false);
  }

  function updateRow(id, patch) {
    setRows((rs) => rs.map((r) => (r._id === id ? { ...r, ...patch } : r)));
  }
  function removeRow(id) {
    setRows((rs) => rs.filter((r) => r._id !== id));
  }
  function addRow() {
    setRows((rs) => [...rs, makeRow({}, cfg.categories[0])]);
  }

  async function save() {
    const items = rows.map((r) => ({
      name_raw: r.name_raw.trim() || '未知商品',
      name_norm: r.name_norm.trim() || null,
      category: r.category,
      subcategory: r.subcategory.trim() || null,
      qty: +r.qty || 0,
      unit: r.unit.trim() || null,
      unit_price: r.unit_price === '' ? null : +r.unit_price,
      amount: +r.amount || 0,
      taxable: r.taxable ? 1 : 0,
    }));
    const receipt = {
      store: store.trim() || '未知',
      purchased_at: date || new Date().toISOString().slice(0, 10),
      currency: cfg.currency || 'CAD',
      subtotal: +subtotal || 0,
      gst: +gst || 0,
      pst: +pst || 0,
      total: +total || 0,
    };
    try {
      await api('/api/receipts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receipt, items, image: currentImage, raw: lastRawRef.current }),
      });
      showToast('已保存 ✓');
      setEditVisible(false);
      setCurrentImage(null);
      setRows([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (e) {
      showToast('保存失败: ' + e.message);
    }
  }

  return (
    <>
      <div className="card">
        <h2>1 · 上传小票图片</h2>
        <div
          id="drop"
          className={dragHover ? 'hover' : ''}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragHover(true); }}
          onDragEnter={(e) => { e.preventDefault(); setDragHover(true); }}
          onDragLeave={(e) => { e.preventDefault(); setDragHover(false); }}
          onDrop={(e) => {
            e.preventDefault();
            setDragHover(false);
            if (e.dataTransfer.files[0]) readImage(e.dataTransfer.files[0]);
          }}
        >点击或拖拽小票图片到这里（支持 Costco / 大统华 等）</div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hide"
          onChange={(e) => { if (e.target.files[0]) readImage(e.target.files[0]); }}
        />
        {currentImage ? <img id="preview" src={currentImage} alt="" /> : null}
        <div className="row" style={{ marginTop: 14 }}>
          <button disabled={!currentImage || scanning} onClick={scan}>AI 识别</button>
          <span className="muted">{scanHint}</span>
        </div>
      </div>

      <div className={'card' + (editVisible ? '' : ' hide')}>
        <h2>2 · 核对并保存</h2>
        <div className="row" style={{ marginBottom: 12 }}>
          <label>商家 <input style={{ width: 140 }} value={store} onChange={(e) => setStore(e.target.value)} /></label>
          <label>日期 <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label>税前 <input type="number" step="0.01" className="num" style={{ width: 90 }} value={subtotal} onChange={(e) => setSubtotal(e.target.value)} /></label>
          <label>GST <input type="number" step="0.01" className="num" style={{ width: 80 }} value={gst} onChange={(e) => setGst(e.target.value)} /></label>
          <label>PST <input type="number" step="0.01" className="num" style={{ width: 80 }} value={pst} onChange={(e) => setPst(e.target.value)} /></label>
          <label>实付 <input type="number" step="0.01" className="num" style={{ width: 90 }} value={total} onChange={(e) => setTotal(e.target.value)} /></label>
        </div>
        <table>
          <thead>
            <tr>
              <th>原文品名</th><th>规范品名</th><th>分类</th><th>细分</th>
              <th className="num">数量</th><th>单位</th><th className="num">单价</th><th className="num">金额</th><th>税</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r._id}>
                <td><input value={r.name_raw} onChange={(e) => updateRow(r._id, { name_raw: e.target.value })} /></td>
                <td><input value={r.name_norm} onChange={(e) => updateRow(r._id, { name_norm: e.target.value })} /></td>
                <td>
                  <select value={r.category} onChange={(e) => updateRow(r._id, { category: e.target.value })}>
                    {cfg.categories.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </td>
                <td><input value={r.subcategory} onChange={(e) => updateRow(r._id, { subcategory: e.target.value })} /></td>
                <td><input type="number" step="0.01" className="num" value={r.qty} onChange={(e) => updateRow(r._id, { qty: e.target.value })} /></td>
                <td><input value={r.unit} onChange={(e) => updateRow(r._id, { unit: e.target.value })} /></td>
                <td><input type="number" step="0.01" className="num" value={r.unit_price} onChange={(e) => updateRow(r._id, { unit_price: e.target.value })} /></td>
                <td><input type="number" step="0.01" className="num" value={r.amount} onChange={(e) => updateRow(r._id, { amount: e.target.value })} /></td>
                <td style={{ textAlign: 'center' }}>
                  <input type="checkbox" checked={r.taxable} onChange={(e) => updateRow(r._id, { taxable: e.target.checked })} />
                </td>
                <td><button className="danger" onClick={() => removeRow(r._id)}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="ghost" onClick={addRow}>+ 添加一行</button>
          <button onClick={save}>保存到账本</button>
        </div>
      </div>
    </>
  );
}
