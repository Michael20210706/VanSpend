'use client';

// 临时对比控件：两个版式定稿前用来来回看。定稿后的删除清单(改动都在这两个文件里)：
//   1. 删掉本文件，和 Landing.js 里的 import / <VariantSwitch/>
//   2. Landing.js: 删掉 variant state 和输的那个 ORDER 数组，留下的直接 const ORDER = [...]
//   3. copy.js: 删掉两份语言里输的那个 heroA / heroB
//   4. landing.css: 删掉 /* ---- A/B 版式切换 ---- */ 那一段
// 语言切换不在此列，那是要长期保留的。
export default function VariantSwitch({ variant, onChange }) {
  return (
    <div className="lp-switch" role="group" aria-label="版式对比">
      {['a', 'b'].map((v) => (
        <button
          key={v}
          type="button"
          className={variant === v ? 'on' : ''}
          onClick={() => onChange(v)}
        >{'1' + v}</button>
      ))}
    </div>
  );
}
