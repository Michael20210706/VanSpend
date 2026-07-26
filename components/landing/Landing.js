'use client';
import { useRef, useState } from 'react';
import { COPY } from './copy';
import { useReveal } from './useReveal';
import VariantSwitch from './VariantSwitch';
import { Nav, Hero, Steps, Tax, Insights, Family, DataSection, Faq, FinalCta, Footer } from './sections';
import './landing.css';

const SECTIONS = { hero: Hero, steps: Steps, tax: Tax, insights: Insights, family: Family, data: DataSection, faq: Faq, cta: FinalCta };

// 两个版式的唯一差别：段落顺序和每段的底色。文案、组件全部共用。
const ORDER = {
  a: [ // 1a 产品先行：白底为主，深色段落穿插
    { k: 'hero' }, { k: 'steps', tone: 'dark' }, { k: 'tax', tone: 'tint' },
    { k: 'insights' }, { k: 'family', tone: 'tint' }, { k: 'data', tone: 'dark' },
    { k: 'faq', tone: 'tint' }, { k: 'cta' },
  ],
  b: [ // 1b 价值先行：黑底开场，家庭故事在前，功能在后
    { k: 'hero' }, { k: 'family' }, { k: 'insights', tone: 'tint' },
    { k: 'tax' }, { k: 'steps', tone: 'dark' }, { k: 'data', tone: 'tint' },
    { k: 'faq', tone: 'tint' }, { k: 'cta', tone: 'dark' },
  ],
};

// 惰性初始化，不用 useEffect：Landing 只在 /api/auth/me 返回之后才挂载，永远是 hydration 之后，
// 不存在 SSR 不一致；放 useEffect 里读反而会先闪一下默认值。
// 也顺手支持 ?v=b / ?lang=en，方便直接发链接对比。
function readPref(key, param, allowed, fallback) {
  if (typeof window === 'undefined') return fallback;
  try {
    const q = new URLSearchParams(window.location.search).get(param);
    if (allowed.includes(q)) { localStorage.setItem(key, q); return q; }
    const saved = localStorage.getItem(key);
    return allowed.includes(saved) ? saved : fallback;
  } catch {
    return fallback; // localStorage 被禁(隐私模式)时不至于把整页拖崩
  }
}

export default function Landing() {
  const [variant, setVariant] = useState(() => readPref('vanspend.lp.variant', 'v', ['a', 'b'], 'a'));
  const [lang, setLang] = useState(() => readPref('vanspend.lp.lang', 'lang', ['zh', 'en'], 'zh'));
  const rootRef = useRef(null);

  // 换版式/换语言会整块换掉 DOM，得重新观察一遍
  useReveal(rootRef, [variant, lang]);

  const t = COPY[lang];
  const navTone = variant === 'b' ? 'dark' : undefined;

  function pick(key, value, setter) {
    setter(value);
    try { localStorage.setItem(key, value); } catch { /* 隐私模式下写不进去，忽略 */ }
  }

  return (
    // lang 挂在这里而不是 <html>(layout.js 固定 zh-CN)：只有落地页是双语的
    <div className="lp" lang={lang === 'en' ? 'en' : 'zh-CN'} ref={rootRef}>
      <Nav
        t={t}
        tone={navTone}
        lang={lang}
        onToggleLang={() => pick('vanspend.lp.lang', lang === 'zh' ? 'en' : 'zh', setLang)}
      />

      {/* key 让切版式时整棵子树重挂：.is-in 是命令式加上去的，不能留到新标记里 */}
      <div key={variant}>
        {ORDER[variant].map(({ k, tone }) => {
          const Section = SECTIONS[k];
          return <Section key={k} t={t} tone={tone} variant={variant} />;
        })}
      </div>

      <Footer t={t} tone={variant === 'b' ? 'dark' : undefined} />

      <VariantSwitch
        variant={variant}
        onChange={(v) => pick('vanspend.lp.variant', v, setVariant)}
      />
    </div>
  );
}
