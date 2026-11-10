'use client';
import { useRef, useState } from 'react';
import { COPY } from './copy';
import { useReveal } from './useReveal';
import { Nav, Hero, Steps, Tax, Insights, Family, DataSection, Faq, FinalCta, Footer } from './sections';
import './landing.css';

const SECTIONS = { hero: Hero, steps: Steps, tax: Tax, insights: Insights, family: Family, data: DataSection, faq: Faq, cta: FinalCta };

// 段落顺序和每段的底色(产品先行：白底为主，深色段落穿插)
const ORDER = [
  { k: 'hero' }, { k: 'steps', tone: 'dark' }, { k: 'tax', tone: 'tint' },
  { k: 'insights' }, { k: 'family', tone: 'tint' }, { k: 'data', tone: 'dark' },
  { k: 'faq', tone: 'tint' }, { k: 'cta' },
];

// 惰性初始化，不用 useEffect：Landing 只在 /api/auth/me 返回之后才挂载，永远是 hydration 之后，
// 不存在 SSR 不一致；放 useEffect 里读反而会先闪一下默认值。
// 也顺手支持 ?lang=en，方便直接发链接。
function readLang() {
  if (typeof window === 'undefined') return 'zh';
  try {
    const q = new URLSearchParams(window.location.search).get('lang');
    if (q === 'zh' || q === 'en') { localStorage.setItem('vanspend.lp.lang', q); return q; }
    const saved = localStorage.getItem('vanspend.lp.lang');
    return saved === 'zh' || saved === 'en' ? saved : 'zh';
  } catch {
    return 'zh'; // localStorage 被禁(隐私模式)时不至于把整页拖崩
  }
}

export default function Landing() {
  const [lang, setLang] = useState(readLang);
  const rootRef = useRef(null);

  // 换语言会整块换掉 DOM，得重新观察一遍
  useReveal(rootRef, [lang]);

  const t = COPY[lang];

  function toggleLang() {
    const next = lang === 'zh' ? 'en' : 'zh';
    setLang(next);
    try { localStorage.setItem('vanspend.lp.lang', next); } catch { /* 隐私模式下写不进去，忽略 */ }
  }

  return (
    // lang 挂在这里而不是 <html>(layout.js 固定 zh-CN)：只有落地页是双语的
    <div className="lp" lang={lang === 'en' ? 'en' : 'zh-CN'} ref={rootRef}>
      <Nav t={t} lang={lang} onToggleLang={toggleLang} />

      {/* key 让切语言时整棵子树重挂：.is-in 是命令式加上去的，不能留到新标记里 */}
      <div key={lang}>
        {ORDER.map(({ k, tone }) => {
          const Section = SECTIONS[k];
          return <Section key={k} t={t} tone={tone} />;
        })}
      </div>

      <Footer t={t} />
    </div>
  );
}
