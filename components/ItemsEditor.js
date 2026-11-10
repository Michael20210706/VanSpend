'use client';
// 明细编辑表格: "扫描后核对"(ScanTab)和"保存后编辑"(ReceiptsTab)共用

let rowSeq = 0;
export function makeRow(it = {}, defaultCategory = '') {
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

// 把表格行转成提交给服务端的明细
export function rowsToItems(rows) {
  return rows.map((r) => ({
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
}

export default function ItemsEditor({ rows, setRows, categories }) {
  const updateRow = (id, patch) => setRows((rs) => rs.map((r) => (r._id === id ? { ...r, ...patch } : r)));
  const removeRow = (id) => setRows((rs) => rs.filter((r) => r._id !== id));
  const addRow = () => setRows((rs) => [...rs, makeRow({}, categories[0])]);
  return (
    <>
      <div className="table-scroll">
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
                    {categories.map((c) => <option key={c}>{c}</option>)}
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
      </div>
      <div className="row" style={{ marginTop: 14 }}>
        <button className="ghost" onClick={addRow}>+ 添加一行</button>
      </div>
    </>
  );
}
