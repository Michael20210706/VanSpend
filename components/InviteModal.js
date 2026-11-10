'use client';
import InviteCodes from './InviteCodes';

// 顶栏"邀请"弹窗: 任何已登录用户都可以生成普通邀请码
export default function InviteModal({ onClose }) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
      }}
      onClick={onClose}
    >
      <div className="card" style={{ width: 560, maxWidth: '94vw', maxHeight: '80vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h2>邀请朋友</h2>
        <InviteCodes kind="personal" />
        <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
          <button onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}
