// 扫描结果快照 vs 保存时的表单 → "改了哪些字段"的**名字**列表，以及随保存一起发出的 meta(保存事件，只用于统计)。
// 只输出名字: receipt.<列>、item[<AI 结果里的下标>].<列>、item[+](加了一行)、item[-](删了一行)；绝不输出值。
// 名字语法和个数上限与服务端 src/receiptInput.cjs 的 validateSaveMeta 是同一套(tests/edit-diff.test.js 对着校验)。
export const MAX_EDITED_FIELDS = 1000;
const MAX_INT = 2147483647;

// 每一列按"保存出去的值"归一后再比较(与 ScanTab.save / ItemsEditor.rowsToItems 的换算一致):
// AI 没给的 null、表单里的空串、数字框里的 "10" 和 10，只要存下来是同一个值就不算改
const text = (v) => String(v ?? '').trim();
const num = (v) => +v || 0;
const optNum = (v) => (v === '' || v == null ? null : +v);
const bool = (v) => !!v;
const RECEIPT_FIELDS = { store: text, purchased_at: text, subtotal: num, gst: num, pst: num, total: num };
const ITEM_FIELDS = {
  name_raw: text, name_norm: text, category: text, subcategory: text,
  qty: num, unit: text, unit_price: optNum, amount: num, taxable: bool,
};

const changed = (a, b, fields) => Object.keys(fields).filter((f) => fields[f](a[f]) !== fields[f](b[f]));

// before / after: { receipt: {store, purchased_at, subtotal, gst, pst, total}, rows: [{ _id, ...明细列 }] }
// 行用 _id(ItemsEditor.makeRow 分配)配对: 留下的行按它在 AI 结果里的下标报告，快照里没有的 _id 是新加的行
export function diffEdits(before, after) {
  const out = changed(before.receipt, after.receipt, RECEIPT_FIELDS).map((f) => `receipt.${f}`);
  const index = new Map(before.rows.map((r, i) => [r._id, i]));
  const kept = new Set();
  let added = 0;
  for (const row of after.rows) {
    const i = index.get(row._id);
    if (i === undefined) { added += 1; continue; }
    kept.add(row._id);
    for (const f of changed(before.rows[i], row, ITEM_FIELDS)) out.push(`item[${i}].${f}`);
  }
  for (const r of before.rows) if (!kept.has(r._id)) out.push('item[-]');
  for (let k = 0; k < added; k++) out.push('item[+]');
  return out.slice(0, MAX_EDITED_FIELDS);
}

// snapshot: 识别完成那一刻记下的 { scanId, at(毫秒时间戳), receipt, rows }；form: 点保存时表单里的 { receipt, rows }。
// 没有快照就不发 meta。毫秒数夹在 INT 范围内，免得服务端的范围校验让一次正常的保存失败
export function buildSaveMeta(snapshot, form, now = Date.now()) {
  if (!snapshot) return undefined;
  return {
    scanId: snapshot.scanId,
    editedFields: diffEdits(snapshot, form),
    itemsAi: snapshot.rows.length,
    scanToSaveMs: Math.min(Math.max(0, Math.round(now - snapshot.at)), MAX_INT),
  };
}
