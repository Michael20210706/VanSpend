import { useEffect, useRef } from 'react';

const FOCUSABLE = 'input:not([disabled]), textarea:not([disabled]), select:not([disabled])';

// 弹窗共用: 打开时把焦点移到第一个输入框(没有则第一个按钮)，Esc 关闭，关闭后焦点还给打开它的元素。
// dismissable=false(强制改密码)时只做聚焦，Esc 不关闭。把返回的 ref 挂在弹窗的内容容器上。
export default function useModal(onClose, dismissable = true) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement;
    const box = ref.current;
    if (box) (box.querySelector(FOCUSABLE) || box.querySelector('button'))?.focus();
    function onKey(e) {
      if (e.key === 'Escape' && dismissable) closeRef.current();
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
    };
  }, [dismissable]);

  return ref;
}
