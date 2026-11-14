'use client';
import InviteCodes from './InviteCodes';
import useModal from '../lib/useModal';

// 顶栏"邀请"弹窗: 生成/查看/作废自己的普通邀请码。只有正常额度的账号和管理员能生成，开放注册的账号会被服务端拒绝(提示在 InviteCodes 的说明文字里)
export default function InviteModal({ onClose }) {
  const boxRef = useModal(onClose);
  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
      }}
      onClick={onClose}
    >
      <div className="card" ref={boxRef} role="dialog" aria-modal="true" style={{ width: 560, maxWidth: '94vw', maxHeight: '80vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h2>邀请朋友</h2>
        <InviteCodes kind="personal" />
        <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
          <button onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}
