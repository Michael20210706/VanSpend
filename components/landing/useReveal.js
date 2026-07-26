'use client';
import { useEffect } from 'react';

// 滚动进场：整页一个 IntersectionObserver，给进入视口的 [data-reveal] 加 .is-in。
//
// 隐藏态写在 .lp[data-reveal-ready] 下面，而这个属性只有在钩子确认要跑观察器时才挂上去——
// 所以一旦提前 return(用户开了"减弱动态效果"、浏览器没有 IntersectionObserver)，
// 内容就是普通可见状态，绝不会永久隐形。
export function useReveal(rootRef, deps) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (typeof IntersectionObserver !== 'function') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    root.dataset.revealReady = '1';
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
      }
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.08 });

    root.querySelectorAll('[data-reveal]').forEach((el) => io.observe(el));
    return () => { io.disconnect(); delete root.dataset.revealReady; };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}
