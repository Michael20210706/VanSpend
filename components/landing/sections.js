'use client';
import Link from 'next/link';
import { PhoneScan, ReceiptCard, YearCard, WeekBars, CategoryDonut, FamilyLedger } from './mocks';

// 落地页的各个段落。全部是 ({ t, tone, variant }) => 标记 的同一种形状：
//   t       = COPY[lang]，文案的唯一来源(见 copy.js)
//   tone    = 'dark' | 'tint' | undefined，决定这一段的底色
//   variant = 'a' | 'b'，只有 hero 和少数几处标题分叉用得到
// 两个版式共用这批组件，差别只在 Landing.js 里的段落顺序和 tone。
//
// 注意：这里不要用 <header> 和 <table>——globals.css 把它们做成了深色 sticky 栏和深色表格。

const SIGNUP = '/login?mode=register';

function secClass(tone) {
  return 'lp-sec' + (tone === 'dark' ? ' lp-sec--dark' : tone === 'tint' ? ' lp-sec--tint' : '');
}

// 文案里的多行标题统一存成数组，这里插 <br>
function Lines({ items }) {
  return items.map((line, i) => (
    <span key={i}>{i ? <br /> : null}{line}</span>
  ));
}

export function Nav({ t, tone, lang, onToggleLang }) {
  return (
    <nav className={'lp-nav' + (tone === 'dark' ? ' lp-nav--dark' : '')}>
      <span className="lp-nav-mark">{t.brand}</span>
      <span className="lp-nav-links">
        <a href="#steps">{t.nav.steps}</a>
        <a href="#tax">{t.nav.tax}</a>
        <a href="#family">{t.nav.family}</a>
        <a href="#faq">{t.nav.faq}</a>
      </span>
      <span className="lp-nav-right">
        <button type="button" className="lp-lang" onClick={onToggleLang}>
          {lang === 'zh' ? '中 / EN' : 'EN / 中'}
        </button>
        <Link href="/login" className="lp-nav-login">{t.nav.login}</Link>
        <Link href={SIGNUP} className="lp-btn lp-btn--sm">{t.nav.signup}</Link>
      </span>
    </nav>
  );
}

export function Hero({ t, variant }) {
  if (variant === 'b') {
    const c = t.heroB;
    return (
      <section className="lp-heroB">
        <div className="lp-heroB-glow" />
        <div className="lp-wrap lp-heroB-grid">
          <div data-reveal>
            <p className="lp-eyebrow">{c.eyebrow}</p>
            <h1 className="lp-h1 lp-h1--b"><Lines items={c.title} /></h1>
            <p className="lp-lede" style={{ marginTop: 24 }}>{c.lede}</p>
            <div className="lp-cta-row" style={{ marginTop: 32 }}>
              <Link href={SIGNUP} className="lp-btn">{c.cta}</Link>
              <a href="#family" className="lp-link">{c.cta2}</a>
            </div>
            <p className="lp-heroB-note">{c.note}</p>
          </div>
          <div className="lp-heroB-stage" data-reveal>
            <YearCard t={t} />
          </div>
        </div>
      </section>
    );
  }

  const c = t.heroA;
  return (
    <section className="lp-heroA">
      <div className="lp-wrap" data-reveal>
        <p className="lp-eyebrow">{c.eyebrow}</p>
        <h1 className="lp-h1"><Lines items={c.title} /></h1>
        <p className="lp-lede">{c.lede}</p>
        <div className="lp-cta-row">
          <Link href={SIGNUP} className="lp-btn">{c.cta}</Link>
          <a href="#steps" className="lp-link">{c.cta2}</a>
        </div>
        <p className="lp-heroA-note">{c.note}</p>
      </div>
      <div className="lp-heroA-stage" data-reveal>
        <div className="lp-heroA-glow" />
        <PhoneScan t={t} />
      </div>
    </section>
  );
}

export function Steps({ t, tone }) {
  return (
    <section id="steps" className={secClass(tone)}>
      <div className="lp-wrap" data-reveal>
        <p className="lp-eyebrow">{t.steps.eyebrow}</p>
        <h2 className="lp-h2"><Lines items={t.steps.title} /></h2>
        <ul className="lp-steps">
          {t.steps.items.map((s, i) => (
            <li className="lp-step" key={s.n} style={{ transitionDelay: i * 70 + 'ms' }}>
              <span className="lp-step-n">{s.n}</span>
              <div className="lp-step-art">{stepArt(t)[i]}</div>
              <div>
                <h3 className="lp-h3">{s.t}</h3>
                <p>{s.d}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// 三步各自的示意图形，纯装饰。第三步的分类胶囊取自文案里的真实分类名
const stepArt = (t) => [
  <>
    <span className="lp-paper" />
    <span className="lp-paper lp-paper--2" />
  </>,
  <div style={{ display: 'flex', flexDirection: 'column', gap: 9, width: '100%' }}>
    <span className="lp-bar-art" style={{ width: '80%' }} />
    <span className="lp-bar-art lp-bar-art--dim" style={{ width: '55%' }} />
    <span className="lp-bar-art" style={{ width: '92%' }} />
  </div>,
  <>
    <span className="lp-chip" style={{ background: 'rgba(10,132,255,.16)', color: '#0a84ff' }}>
      {t.mock.cats[0].n}
    </span>
    <span className="lp-chip" style={{ background: 'rgba(25,158,112,.18)', color: '#3ddc97' }}>
      {t.mock.cats[1].n}
    </span>
    <span className="lp-chip" style={{ background: 'rgba(201,133,0,.2)', color: '#f0b429' }}>
      {t.mock.cats[3].n}
    </span>
  </>,
];

export function Tax({ t, tone, variant }) {
  if (variant === 'b') {
    return (
      <section id="tax" className={secClass(tone)}>
        <div className="lp-wrap lp-tax-center" data-reveal>
          <p className="lp-eyebrow">{t.tax.eyebrow}</p>
          <h2 className="lp-h2"><Lines items={t.tax.titleB} /></h2>
          <p className="lp-lede" style={{ marginTop: 20 }}>{t.tax.lede}</p>
        </div>
        <div className="lp-wrap lp-tax-center-stage" data-reveal>
          <ReceiptCard t={t} wide />
        </div>
      </section>
    );
  }
  return (
    <section id="tax" className={secClass(tone)}>
      <div className="lp-wrap lp-tax-grid" data-reveal>
        <div>
          <p className="lp-eyebrow">{t.tax.eyebrow}</p>
          <h2 className="lp-h2"><Lines items={t.tax.titleA} /></h2>
          <p className="lp-lede" style={{ marginTop: 20 }}>{t.tax.lede}</p>
          <ul className="lp-tax-bullets">
            {t.tax.bullets.map((b) => (
              <li key={b}><span className="lp-dot" />{b}</li>
            ))}
          </ul>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <ReceiptCard t={t} />
        </div>
      </div>
    </section>
  );
}

export function Insights({ t, tone, variant }) {
  return (
    <section id="insights" className={secClass(tone)}>
      <div className="lp-wrap" data-reveal>
        <p className="lp-eyebrow">{t.insights.eyebrow}</p>
        <h2 className="lp-h2"><Lines items={variant === 'b' ? t.insights.titleB : t.insights.titleA} /></h2>
        <p className="lp-lede" style={{ marginTop: 18, maxWidth: 640 }}>{t.insights.lede}</p>
        <div className="lp-insights-grid">
          <WeekBars t={t} />
          <CategoryDonut t={t} />
        </div>
        <p className="lp-panel-note" style={{ marginTop: 22 }}>{t.insights.trendNote}</p>
      </div>
    </section>
  );
}

export function Family({ t, tone, variant }) {
  const copy = (
    <div className="lp-family-copy">
      <p className="lp-eyebrow">{t.family.eyebrow}</p>
      <h2 className="lp-h2"><Lines items={variant === 'b' ? t.family.titleB : t.family.titleA} /></h2>
      <p className="lp-lede" style={{ marginTop: 20 }}>{t.family.lede}</p>
      <p className="lp-family-note">{t.family.note}</p>
    </div>
  );
  const card = <FamilyLedger t={t} />;
  return (
    <section id="family" className={secClass(tone)}>
      <div className={'lp-wrap lp-family-grid' + (variant === 'b' ? ' lp-family-grid--flip' : '')} data-reveal>
        {variant === 'b' ? <>{card}{copy}</> : <>{copy}{card}</>}
      </div>
    </section>
  );
}

export function DataSection({ t, tone }) {
  return (
    <section id="data" className={secClass(tone)}>
      <div className="lp-wrap lp-data" data-reveal>
        <div className="lp-lock"><i /></div>
        <h2 className="lp-h2"><Lines items={t.data.title} /></h2>
        <p className="lp-lede" style={{ marginTop: 20 }}>{t.data.lede}</p>
        <ul className="lp-data-cards">
          {t.data.cards.map((c, i) => (
            <li className="lp-data-card" key={c.t} style={{ transitionDelay: i * 70 + 'ms' }}>
              <h3>{c.t}</h3>
              <p>{c.d}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function Faq({ t, tone }) {
  return (
    <section id="faq" className={secClass(tone)}>
      <div className="lp-wrap" data-reveal>
        <div className="lp-faq">
          <h2 className="lp-h2">{t.faq.title}</h2>
          {t.faq.items.map((f) => (
            <details key={f.q}>
              <summary>
                <span>{f.q}</span>
                <span className="lp-faq-plus" aria-hidden="true">+</span>
              </summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function FinalCta({ t, tone, variant }) {
  return (
    <section className={secClass(tone)}>
      <div className="lp-wrap lp-final" data-reveal>
        <h2 className="lp-h2"><Lines items={variant === 'b' ? t.cta.titleB : t.cta.titleA} /></h2>
        <div className="lp-cta-row">
          <Link href={SIGNUP} className="lp-btn">{t.cta.btn}</Link>
          <Link href="/login" className="lp-link">{t.cta.link}</Link>
        </div>
      </div>
    </section>
  );
}

export function Footer({ t, tone }) {
  return (
    <div className={'lp-footer' + (tone === 'dark' ? ' lp-footer--dark' : '')}>
      <div className="lp-wrap lp-footer-row">
        <span className="lp-footer-mark">{t.brand}</span>
        <span>{t.footer.place}</span>
        <span className="lp-footer-links">
          <Link href="/login">{t.footer.login}</Link>
          <Link href={SIGNUP}>{t.footer.signup}</Link>
        </span>
      </div>
    </div>
  );
}
