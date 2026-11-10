'use client';
import { useRef, useState } from 'react';
import { api } from '../lib/api';
import { showToast } from '../lib/toast';
import ItemsEditor, { makeRow, rowsToItems } from './ItemsEditor';

// 上传前压缩到的最大长边(像素)，见 readImage()
const MAX_EDGE = 2000;

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

  // 上传前把长边压缩到 MAX_EDGE 像素以内(重新编码为 JPEG)：手机原图常有 4000+ 像素、数 MB，
  // 压缩后传给模型的数据量和费用都更小，小票文字仍清晰。本来就不大的图原样保留；浏览器解码不了的格式也原样上传，
  // 由服务端的 10 MB 上限兜底。
  function readImage(file) {
    const r = new FileReader();
    r.onload = () => {
      const original = r.result;
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
        if (scale === 1) { setCurrentImage(original); return; }
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        setCurrentImage(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => setCurrentImage(original);
      img.src = original;
    };
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

  async function save() {
    const items = rowsToItems(rows);
    const receipt = {
      store: store.trim() || '未知',
      purchased_at: date || new Date().toISOString().slice(0, 10),
      currency: cfg.currency || 'CAD',
      subtotal: +subtotal || 0,
      gst: +gst || 0,
      pst: +pst || 0,
      total: +total || 0,
    };
    // 重复提示: 同商家 + 同日期 + 同总额(家庭内/自己的)。只提示，用户可以选择仍然保存
    try {
      const q = `store=${encodeURIComponent(receipt.store)}&date=${receipt.purchased_at}&total=${receipt.total}`;
      const dups = await api('/api/receipts/duplicates?' + q);
      if (dups.length > 0) {
        const lines = dups.map((d) => `· ${d.purchased_at} ${d.store} $${Number(d.total).toFixed(2)}（${d.owner_username}）`).join('\n');
        if (!confirm(`可能重复：已有商家、日期、总额都相同的小票：\n${lines}\n\n仍要保存吗？`)) return;
      }
    } catch (e) {
      // 查重失败不应挡住保存
    }
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
        <ItemsEditor rows={rows} setRows={setRows} categories={cfg.categories} />
        <div className="row" style={{ marginTop: 14 }}>
          <button onClick={save}>保存到账本</button>
        </div>
      </div>
    </>
  );
}
