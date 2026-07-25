'use client';
import AuthGate from './AuthGate';

// 未登录时的落地页：左侧介绍/宣传，右侧登录注册表单(窄屏下表单排在介绍之前，方便老用户直接登录)
const FEATURES = [
  { ico: '📷', title: '拍照即录入', desc: 'Costco、T&T、超市小票拍一张传上来，多模态大模型逐行读出商品名、数量、单价和小计，不用手敲。' },
  { ico: '🧮', title: 'GST/PST 自动拆分', desc: '按 BC 省 5% GST + 7% PST 规则区分应税与免税商品；小票只印一行合计税时，按比例估算拆分。' },
  { ico: '✅', title: '先复核再入库', desc: 'AI 读完先进可编辑表格，改错、补漏、确认无误后才保存，不让一次误读直接写进账本。' },
  { ico: '👨‍👩‍👧', title: '家庭共享账本', desc: '创建家庭或申请加入已有家庭，成员之间互相可见彼此的小票与统计；删除和修改始终只限本人。' },
  { ico: '📊', title: '分类与月度分析', desc: '分类占比、子类明细、月度堆叠趋势和税额构成，一眼看清钱花在了哪一类上。' },
  { ico: '📈', title: '同商品比价', desc: '同一样商品在不同时间、不同店的单价连成曲线，判断这次到底是真降价还是错觉。' },
];

const STEPS = [
  { n: 1, title: '上传小票照片', desc: '拖进来或选文件，几秒钟出结果。' },
  { n: 2, title: '核对明细', desc: '在表格里改分类、改价格，确认无误。' },
  { n: 3, title: '保存并分析', desc: '入库后自动进入分类、月度和比价图表。' },
];

export default function AuthLanding({ cfg, onLoggedIn }) {
  const catCount = cfg?.categories?.length || 0;

  return (
    <div className="auth-page">
      <section className="auth-hero">
        <h1>🧾 VanSpend</h1>
        <p className="auth-tagline">温哥华家庭小票精细化记账</p>
        <p className="auth-lede">
          拍一张小票，AI 自动读出每一行商品、归类，并把 GST / PST 拆开算清；
          一家人共享同一份账本，月底不用再对着一堆纸条回忆钱花在哪了。
        </p>
        <div className="auth-pills">
          <span className="auth-pill">BC 税制 · GST 5% + PST 7%</span>
          {catCount ? <span className="auth-pill">{catCount} 类消费分类</span> : null}
          <span className="auth-pill">{cfg?.currency || 'CAD'} 计价</span>
          {cfg?.model ? <span className="auth-pill">识别模型 · {cfg.model}</span> : null}
        </div>
      </section>

      <div className="auth-cols">
        <div className="auth-intro">
          <div className="card">
            <h2>能做什么</h2>
            <ul className="feat-list">
              {FEATURES.map((f) => (
                <li className="feat" key={f.title}>
                  <span className="feat-ico" aria-hidden="true">{f.ico}</span>
                  <div>
                    <b>{f.title}</b>
                    <p>{f.desc}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="card">
            <h2>三步记完一张小票</h2>
            <ol className="steps">
              {STEPS.map((s) => (
                <li key={s.n}>
                  <span className="step-n" aria-hidden="true">{s.n}</span>
                  <div>
                    <b>{s.title}</b>
                    <p>{s.desc}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="muted auth-note">
              小票原图只存在本机 <code>uploads/</code> 目录，结构化数据存在自建 MySQL；
              家庭内部自用，不做公网托管，也不上传到任何第三方账本服务。
            </p>
          </div>
        </div>

        <div className="auth-form">
          <AuthGate onLoggedIn={onLoggedIn} />
          <p className="muted auth-note">
            注册开放自助完成，需要填一道图形算式验证码。个人账号可以之后再加入家庭，
            也可以注册时就创建一个家庭并邀请家人。
          </p>
        </div>
      </div>
    </div>
  );
}
