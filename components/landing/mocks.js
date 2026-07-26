'use client';
// 落地页的示意视觉件。全部纯 CSS/DOM，没有图片资源(Dockerfile 不拷 public/，
// standalone 产物也不带)。里面的数字是写死的示例，不接任何接口——所以每张卡都带一个"示例"角标。
//
// 尺寸全用 em，根元素上一个 font-size 就能整体缩放，见 landing.css 的响应式段落。

const TAG_CLASS = { 免税: 'lp-tag--ex', EXEMPT: 'lp-tag--ex', 'GST+PST': 'lp-tag--both', GST: 'lp-tag--gst' };

function ReceiptLines({ t, showTags }) {
  return (
    <div className="lp-receipt-body">
      {t.mock.items.map((it) => (
        <div className="lp-receipt-row" key={it.n}>
          <span>
            {showTags ? <span className={'lp-tag ' + (TAG_CLASS[it.tag] || 'lp-tag--gst')}>{it.tag}</span> : null}
            {it.n}
          </span>
          <span>{it.p}</span>
        </div>
      ))}
      <div className="lp-receipt-rule" />
      {showTags ? (
        <div className="lp-receipt-row lp-receipt-mut"><span>{t.mock.subtotal}</span><span>35.76</span></div>
      ) : null}
      <div className="lp-receipt-row lp-receipt-mut"><span>GST 5%</span><span>0.95</span></div>
      <div className="lp-receipt-row lp-receipt-mut"><span>PST 7%</span><span>0.30</span></div>
      <div className="lp-receipt-row lp-receipt-total"><span>{t.mock.total}</span><span>37.01</span></div>
    </div>
  );
}

/** 手机模型：屏幕里一张小票 + 一条来回扫描的高亮带 */
export function PhoneScan({ t }) {
  return (
    <div className="lp-phone">
      <div className="lp-phone-screen">
        <div className="lp-phone-notch"><i /></div>
        <div className="lp-phone-head">
          <b>{t.mock.week}</b>
          <span className="lp-num">$214.60</span>
        </div>
        <div className="lp-phone-chips">
          {t.mock.cats.slice(0, 3).map((c) => <span key={c.n}>{c.n}</span>)}
        </div>
        <div className="lp-receipt lp-receipt--in">
          <div className="lp-receipt-head"><span>{t.mock.store}</span><span>07 / 21</span></div>
          <ReceiptLines t={t} showTags={false} />
          <div className="lp-scan" />
        </div>
        <div className="lp-phone-foot">
          <i />
          <span>{t.mock.scanned}</span>
        </div>
      </div>
    </div>
  );
}

/** 独立票据卡：每行带 免税 / GST / GST+PST 标签，用在拆税段落 */
export function ReceiptCard({ t, wide }) {
  return (
    <div className={'lp-receipt lp-receipt--card' + (wide ? ' lp-receipt--wide' : '')}>
      <div className="lp-receipt-sheen" />
      <div className="lp-receipt-head"><span>{t.mock.store}</span><span>2026-07-21</span></div>
      <ReceiptLines t={t} showTags />
    </div>
  );
}

/** hero B 的年度金额卡 + 一张漂浮的小票 */
export function YearCard({ t }) {
  const bars = [52, 64, 46, 74, 58, 88, 70];
  const s = t.heroB.stat;
  return (
    <>
      <div className="lp-yearcard">
        <span className="lp-sample">{t.mock.sample}</span>
        <div className="lp-yearcard-label">{s.label}</div>
        <div className="lp-yearcard-value">{s.value}</div>
        <div className="lp-yearcard-bars">
          {bars.map((h, i) => <i key={i} className={i === 5 ? 'on' : ''} style={{ height: h + '%' }} />)}
        </div>
        <div className="lp-yearcard-axis"><span>{s.from}</span><span>{s.to}</span></div>
        <div className="lp-yearcard-tax">
          <span>{s.taxLabel}</span>
          <span className="lp-num" style={{ fontWeight: 600 }}>{s.taxValue}</span>
        </div>
      </div>
      <div className="lp-float" aria-hidden="true">
        <div><span>MILK</span><span>6.49</span></div>
        <div><span>EGGS</span><span>5.99</span></div>
        <div><span>SOAP</span><span>4.29</span></div>
        <hr />
        <div style={{ fontWeight: 700 }}><span>TOTAL</span><span>37.01</span></div>
      </div>
    </>
  );
}

/** 近六周柱图。柱子从 0 长起来，靠父级 [data-reveal] 的 .is-in 触发，不另起一套机制 */
export function WeekBars({ t }) {
  const weeks = [
    { k: 'W24', h: 96 }, { k: 'W25', h: 132 }, { k: 'W26', h: 78 },
    { k: 'W27', h: 158, on: true }, { k: 'W28', h: 110 }, { k: 'W29', h: 88 },
  ];
  return (
    <div className="lp-panel">
      <span className="lp-sample">{t.mock.sample}</span>
      <div className="lp-panel-head">
        <span className="lp-panel-title">{t.insights.barsTitle}</span>
        <span className="lp-panel-big lp-num">$1,284</span>
      </div>
      <div className="lp-bars">
        {weeks.map((w, i) => (
          <div key={w.k}>
            <b className={w.on ? 'on' : ''} style={{ height: w.h + 'px', transitionDelay: i * 70 + 'ms' }} />
            <span className={w.on ? 'on' : ''}>{w.k}</span>
          </div>
        ))}
      </div>
      <p className="lp-panel-note">{t.insights.barsNote}</p>
    </div>
  );
}

/** 类别占比环图。颜色取自 globals.css 里那套已做过 CVD/对比度校验的图表色 */
const DONUT_COLORS = ['#0071e3', '#199e70', '#c98500', '#5e5ce6', '#d55181', '#d2d2d7'];

export function CategoryDonut({ t }) {
  const cats = t.mock.cats;
  return (
    <div className="lp-panel">
      <span className="lp-sample">{t.mock.sample}</span>
      <span className="lp-panel-title">{t.insights.donutTitle}</span>
      <div className="lp-donut">
        <i><small>{cats[0].n}</small><b>{cats[0].v}</b></i>
      </div>
      <div className="lp-legend">
        {cats.map((c, i) => (
          <div key={c.n}>
            <i style={{ background: DONUT_COLORS[i] }} />
            <span>{c.n}</span>
            <em>{c.v}</em>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 家庭账本卡：三个人各记一笔，汇到同一本账 */
export function FamilyLedger({ t }) {
  return (
    <div className="lp-ledger">
      <span className="lp-sample">{t.mock.sample}</span>
      <div className="lp-ledger-head">
        <b>{t.family.ledgerTitle}</b>
        <div className="lp-avatars">
          {t.mock.ledger.map((r, i) => (
            <span key={r.who} className={'lp-av lp-av--' + (i + 1)}>{r.who}</span>
          ))}
        </div>
      </div>
      <div className="lp-ledger-rows">
        {t.mock.ledger.map((r, i) => (
          <div className="lp-ledger-row" key={r.what}>
            <span className={'lp-av lp-av--' + (i + 1)}>{r.who}</span>
            <span className="lp-ledger-what">{r.what}</span>
            <b className="lp-num">{r.amt}</b>
          </div>
        ))}
        <div className="lp-ledger-total">
          <span>{t.family.ledgerTotalLabel}</span>
          <b className="lp-num">$1,842.60</b>
        </div>
      </div>
    </div>
  );
}
