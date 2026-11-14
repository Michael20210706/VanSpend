'use client';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { showToast } from '../lib/toast';
import { formatDateTime, utcTitle } from '../lib/time';
import useModal from '../lib/useModal';

export default function FeedbackModal({ onClose }) {
  const [content, setContent] = useState('');
  const [history, setHistory] = useState([]);
  const [err, setErr] = useState('');
  const boxRef = useModal(onClose);

  async function load() {
    setHistory(await api('/api/feedback'));
  }

  useEffect(() => { load(); }, []);

  async function submit() {
    if (!content.trim()) { setErr('请输入反馈内容'); return; }
    try {
      await api('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content.trim() }),
      });
      setContent('');
      setErr('');
      showToast('已提交反馈，感谢意见');
      load();
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
      }}
      onClick={onClose}
    >
      <div className="card" ref={boxRef} role="dialog" aria-modal="true" style={{ width: 420, maxHeight: '80vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h2>意见反馈</h2>
        <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
          <textarea
            placeholder="发现了 bug，或者有改进建议？写在这里"
            rows={4}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <span style={{ color: 'var(--bad)', fontSize: 13 }}>{err}</span>
          <div className="row">
            <button onClick={submit}>提交</button>
            <button onClick={onClose} style={{ background: 'var(--line)', color: 'inherit' }}>关闭</button>
          </div>
        </div>

        {history.length > 0 && (
          <>
            <h2 style={{ marginTop: 18 }}>我提交过的反馈</h2>
            <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              {history.map((f) => (
                <div key={f.id} className="muted" style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
                  <div style={{ fontSize: 12 }} title={utcTitle(f.created_at)}>{formatDateTime(f.created_at)}</div>
                  <div>{f.content}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
