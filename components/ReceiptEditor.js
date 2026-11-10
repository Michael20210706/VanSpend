'use client';
import { useState } from 'react';
import { api, fmt } from '../lib/api';
import { showToast } from '../lib/toast';
import ItemsEditor, { makeRow, rowsToItems } from './ItemsEditor';

// 保存后编辑一张自己的小票: 可改商家、日期、GST/PST、明细(增删改)。
// 税前小计和实付由服务端按明细重算(小计 = 明细金额之和，实付 = 小计 + GST + PST)，这里只显示预览。
export default function ReceiptEditor({ receipt, categories, onSaved, onCancel }) {
  const [store, setStore] = useState(receipt.store || '');
  const [date, setDate] = useState(receipt.purchased_at || '');
  const [gst, setGst] = useState(receipt.gst ?? 0);
  const [pst, setPst] = useState(receipt.pst ?? 0);
  const [rows, setRows] = useState(() => receipt.items.map((it) => makeRow(it)));
  const [saving, setSaving] = useState(false);

  const subtotal = rows.reduce((s, r) => s + (+r.amount || 0), 0);
  const total = subtotal + (+gst || 0) + (+pst || 0);

  async function save() {
    setSaving(true);
    try {
      const updated = await api('/api/receipts/' + receipt.id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receipt: { store: store.trim(), purchased_at: date, gst: +gst || 0, pst: +pst || 0 },
          items: rowsToItems(rows),
        }),
      });
      showToast('已保存修改 ✓');
      onSaved(updated);
    } catch (e) {
      showToast('保存失败: ' + e.message);
    }
    setSaving(false);
  }

  return (
    <div className="card">
      <h2>编辑小票</h2>
      <div className="row" style={{ marginBottom: 12 }}>
        <label>商家 <input style={{ width: 140 }} value={store} onChange={(e) => setStore(e.target.value)} /></label>
        <label>日期 <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label>GST <input type="number" step="0.01" className="num" style={{ width: 80 }} value={gst} onChange={(e) => setGst(e.target.value)} /></label>
        <label>PST <input type="number" step="0.01" className="num" style={{ width: 80 }} value={pst} onChange={(e) => setPst(e.target.value)} /></label>
        <span className="muted">税前 ${fmt(subtotal)} ｜ 实付 ${fmt(total)}（保存时按明细重算）</span>
      </div>
      <ItemsEditor rows={rows} setRows={setRows} categories={categories} />
      <div className="row" style={{ marginTop: 14 }}>
        <button disabled={saving} onClick={save}>保存修改</button>
        <button className="ghost" onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}
