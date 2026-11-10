// 落地页唯一文案来源。zh / en 两份结构完全一致，段落组件只认 t = COPY[lang]。
//
// 写文案的一条硬规矩：只写这个应用真做得到的事。设计稿里的"照片不上传"、"端到端加密"、
// "分类会自动学习"、"一键导出 CSV"、"最多 6 位成员"、"年度报税包"都已按实际实现改写或删除——
// 照片是上传到站点服务器的 uploads/、识别时发给 OpenRouter 的多模态模型，分类每次现给不记忆，
// 没有导出功能，家庭成员数不限，邀请按用户名；站点管理员能查看和删除任何账号的小票；
// 注册有两条路：邀请码(正常额度，每天 20 次识别)或开放注册(图形验证码，每天 3 次识别，管理员可调高，数值见 config/config.json 的 scanQuota)。
// 改文案前先确认代码真支持。

export const COPY = {
  zh: {
    brand: 'VanSpend',
    nav: { steps: '怎么用', tax: '拆税', family: '家庭账本', faq: '常见问题', login: '登录', signup: '注册' },

    hero: {
      eyebrow: '温哥华 · 家庭小票记账',
      title: ['拍一下小票，', '这个月的钱就清楚了。'],
      lede: '买完菜顺手一拍。商品、金额、GST 和 PST，AI 逐行读出来；你核对一眼，它就进了全家共用的那本账。',
      cta: '注册',
      cta2: '看看怎么用 ›',
      note: '不用下载 · 浏览器打开就能用 · 凭邀请码注册，或直接开放注册',
    },

    steps: {
      eyebrow: '三步',
      title: ['拍、认、核。', '剩下的它替你算。'],
      items: [
        { n: '01', t: '拍下小票', d: '结账后随手一张，或从相册选一张传上来。歪一点、皱一点，通常都读得出来。' },
        { n: '02', t: '逐项读出来', d: '店名、每件商品、数量、单价、小计，还有 GST 和 PST，一条条列成表格。' },
        { n: '03', t: '核对后入账', d: 'AI 会读错，所以保存前先过你这一关：表格里改完再存，然后自动进入分类和图表。' },
      ],
    },

    tax: {
      eyebrow: 'GST · PST',
      title: ['BC 的税，', '本来就该分开算。'],
      lede: '牛奶免税，洗碗液两种税都收。VanSpend 逐项判断应税与否，按 BC 的 5% GST 和 7% PST 分开记；小票只印了一行合计税时，按应税商品的比例把它拆回两种税。',
      bullets: [
        '逐项判断：免税 / GST / GST + PST',
        '只印一行税的小票，按比例估算拆分',
        '分类、子类、月度视图里都能看到税额构成',
      ],
    },

    insights: {
      eyebrow: '消费分析',
      title: ['钱去哪了，一眼就看见。'],
      lede: '分类占比、子类明细、月度堆叠趋势，还有同一样商品跨时间的单价曲线——不用你自己算。',
      barsTitle: '近六周支出',
      barsNote: '第 27 周高出平均 $61，多在餐厅外食。',
      donutTitle: '类别占比',
      trendNote: '同一样商品换个时间、换家店买，单价变没变，连成线就知道。',
    },

    family: {
      eyebrow: '家庭共享',
      title: ['一个账本，', '全家一起记。'],
      lede: '妈妈买菜、爸爸加油、孩子买文具，都落进同一本账。谁花的、花在哪，摊开来看，月底不用再互相回忆。',
      note: '成员数量不限 · 创建者邀请或审核加入 · 互相可见，但只有本人能删自己的记录',
      ledgerTitle: '陈家 · 七月',
      ledgerTotalLabel: '七月至今',
    },

    data: {
      eyebrow: '数据',
      title: ['数据放在哪，', '说清楚。'],
      lede: 'VanSpend 是自托管的应用，你用的这个站点由它的运营者部署：小票原图存在运营者服务器的 uploads/ 目录，结构化明细存在它的 MySQL。没有广告，不卖数据，也不接第三方记账服务。',
      cards: [
        { t: '识别会发给外部模型', d: '识别那一步会把小票图片发给运营者配置的 OpenRouter 模型，除此之外不外传。' },
        { t: '谁能看到你的小票', d: '同一家庭的成员能互相看到；站点管理员可以查看、删除任何账号的小票；其他用户看不到。' },
        { t: '想走就能清空', d: '小票随时可以删；注销账号会连带删除你的小票、明细和原图。' },
      ],
    },

    faq: {
      title: '常见问题',
      items: [
        { q: '识别错了怎么办？', a: '保存前那一步就是留给你改的：识别结果先进可编辑表格，商品名、数量、单价、分类、是否应税都能改，确认无误才写进数据库。保存之后发现错了，也可以在「小票记录」里改自己的小票（商家、日期、GST/PST、明细都能改，税前和实付按明细重算）。保存前如果家庭内已经有商家、日期、总额都相同的小票，会提醒你可能重复，由你决定还要不要存。' },
        { q: '支持哪些小票？', a: 'Costco、T&T 这类超市，以及药房、餐厅的小票都可以，纸质拍照或电子小票截图都行。识别质量取决于你配置的多模态模型（默认 Gemini 2.5 Flash）。' },
        { q: '税是怎么拆的？', a: '按 BC 省的 5% GST + 7% PST 逐项判断应税与否。小票只印了一行合计税时，按应税商品的比例估算拆回两种税——是估算，不是从小票上抄的。' },
        { q: '怎么注册？一定要邀请吗？', a: '不一定，有两条路：有邀请码（由已有的正常额度账号生成，一次性、7 天有效）就直接注册，每天可识别 20 张小票；没有邀请码也可以开放注册，填一道图形算式验证码即可，每天可识别 3 张，管理员可以把额度调高。' },
        { q: '家人怎么加进来？', a: '每人注册自己的账号。创建家庭的人可以按用户名邀请（立即生效），或者对方先申请、由创建者审核通过。同一家庭的成员能看到彼此的小票和统计，但删改始终只限本人。' },
        { q: '数据存在哪，能带走吗？', a: '明细在站点运营者的 MySQL，图片在其服务器的 uploads/ 目录。目前没有一键导出功能。你可以随时删除小票；注销账号会连带清空这个账号的小票、明细和原图。' },
        { q: '比价准吗？', a: '跨时间比价靠的是模型归一化后的商品名做模糊匹配，不是条码或 SKU，所以偶尔会把相近的东西并到一起。趋势可以信，个别点要自己看一眼。' },
      ],
    },

    cta: {
      title: ['从今天这张小票开始。'],
      btn: '注册',
      link: '已有账号，登录 ›',
    },

    footer: { place: '温哥华 · 不列颠哥伦比亚', login: '登录', signup: '注册' },

    mock: {
      sample: '示例',
      week: '本周',
      store: '本地超市',
      items: [
        { n: '牛奶 2L', p: '6.49', tag: '免税' },
        { n: '鸡蛋 12', p: '5.99', tag: '免税' },
        { n: '洗碗液', p: '4.29', tag: 'GST+PST' },
        { n: '咖啡豆', p: '18.99', tag: 'GST' },
      ],
      subtotal: '小计',
      total: '合计',
      scanned: '已识别 4 项 · 税已拆分',
      cats: [
        { n: '肉类', v: '28%' },
        { n: '蔬菜', v: '22%' },
        { n: '主食粮油', v: '18%' },
        { n: '餐厅外食', v: '17%' },
        { n: '日用清洁', v: '9%' },
        { n: '其他', v: '6%' },
      ],
      ledger: [
        { who: '妈', what: '本地超市 · 蔬菜', amt: '$37.01' },
        { who: '爸', what: '加油站 · 其他', amt: '$68.40' },
        { who: '哥', what: '文具店 · 其他', amt: '$12.85' },
      ],
    },
  },

  en: {
    brand: 'VanSpend',
    nav: { steps: 'How it works', tax: 'Tax split', family: 'Family', faq: 'FAQ', login: 'Log in', signup: 'Sign up' },

    hero: {
      eyebrow: 'Vancouver · receipts for families',
      title: ['Snap the receipt.', 'The month adds up on its own.'],
      lede: 'One photo after checkout. AI reads every line — items, amounts, GST and PST. You check it once, and it files into the ledger your family shares.',
      cta: 'Sign up',
      cta2: 'See how it works ›',
      note: 'No download · runs in your browser · sign up with an invite code, or open sign-up',
    },

    steps: {
      eyebrow: 'Three steps',
      title: ['Snap, read, check.', 'It does the arithmetic.'],
      items: [
        { n: '01', t: 'Snap it', d: 'One photo at the till, or pick one from your camera roll. Tilted or crumpled usually still reads fine.' },
        { n: '02', t: 'Read line by line', d: 'Store, every item, quantity, unit price, subtotal — plus GST and PST — laid out as a table.' },
        { n: '03', t: 'Check, then file', d: 'AI misreads things, so nothing is saved until you say so. Fix the table, save, and the charts update.' },
      ],
    },

    tax: {
      eyebrow: 'GST · PST',
      title: ['In BC, tax was', 'never one number.'],
      lede: 'Milk is exempt; dish soap takes both. VanSpend judges item by item and records BC’s 5% GST and 7% PST separately. When a receipt prints only one combined tax line, it splits that back by the ratio of taxable items.',
      bullets: [
        'Per item: exempt / GST / GST + PST',
        'One combined tax line gets split by ratio',
        'Tax breakdown visible by category, subcategory and month',
      ],
    },

    insights: {
      eyebrow: 'Insights',
      title: ['See where it went, at a glance.'],
      lede: 'Category shares, subcategory detail, monthly stacked trends, and the unit price of one item tracked across time — no spreadsheet required.',
      barsTitle: 'Last six weeks',
      barsNote: 'Week 27 ran $61 above average — mostly eating out.',
      donutTitle: 'By category',
      trendNote: 'Same item, different week or different store — the line tells you whether the price actually moved.',
    },

    family: {
      eyebrow: 'Shared ledger',
      title: ['One ledger,', 'the whole family.'],
      lede: 'Groceries, gas, school supplies — all in one book. Who spent what, plainly visible, so nobody has to remember at month end.',
      note: 'No member cap · invite by username or approve a request · everyone can see, only the owner can delete',
      ledgerTitle: 'The Chens · July',
      ledgerTotalLabel: 'July so far',
    },

    data: {
      eyebrow: 'Your data',
      title: ['Where your data lives,', 'stated plainly.'],
      lede: 'VanSpend is self-hosted, and this site is run by whoever deployed it: receipt photos sit in the uploads/ folder on the operator’s server, and the structured detail lives in its MySQL. No ads, no data selling, no third-party bookkeeping service.',
      cards: [
        { t: 'Reading goes to an external model', d: 'The scan step sends the receipt image to the OpenRouter model the operator configured. Nothing else goes out.' },
        { t: 'Who can see your receipts', d: 'Members of the same family see each other’s; the site admin can view and delete any account’s receipts; other users cannot.' },
        { t: 'You can clear it out', d: 'Delete receipts any time; deleting your account removes your receipts, items and original images.' },
      ],
    },

    faq: {
      title: 'Questions',
      items: [
        { q: 'What if it reads something wrong?', a: "That's what the review step is for. Results land in an editable table first — name, quantity, unit price, category, taxable flag — and nothing is written to the database until you confirm. If you spot a mistake after saving, edit your own receipt from the receipts list (store, date, GST/PST, line items; subtotal and total are recomputed from the items). Before saving, if the family already has a receipt with the same store, date and total, you get a possible-duplicate warning and decide whether to save anyway." },
        { q: 'Which receipts work?', a: 'Supermarkets like Costco and T&T, plus pharmacies and restaurants; paper photos or screenshots of emailed receipts. Accuracy depends on the multimodal model you configure (Gemini 2.5 Flash by default).' },
        { q: 'How is the tax split done?', a: "Item by item against BC's 5% GST and 7% PST. If the receipt prints only one combined tax line, it's split back by the ratio of taxable items — an estimate, not something copied off the paper." },
        { q: 'How do I sign up? Do I need an invite?', a: 'No, there are two ways: with an invite code (generated by an existing standard-quota account; single-use, valid 7 days) you sign up directly and can scan 20 receipts a day; without one you can use open sign-up with a small arithmetic captcha, which allows 3 scans a day until an admin raises it.' },
        { q: 'How do family members join?', a: 'Everyone registers their own account. The family creator can invite by username (effective immediately), or someone can apply and wait for the creator to approve. Members see each other’s receipts and stats; editing and deleting stay owner-only.' },
        { q: 'Where is my data, and can I take it out?', a: 'Line items are in the site operator’s MySQL and images in the uploads/ folder on its server. There is no one-click export yet. You can delete receipts any time; deleting your account removes its receipts, items and original images.' },
        { q: 'Is the price comparison reliable?', a: 'Matching across time uses the model-normalised item name, not a barcode or SKU, so similar things occasionally merge. Trust the trend; eyeball the individual points.' },
      ],
    },

    cta: {
      title: ["Start with today's receipt."],
      btn: 'Sign up',
      link: 'Already have an account ›',
    },

    footer: { place: 'Vancouver, British Columbia', login: 'Log in', signup: 'Sign up' },

    mock: {
      sample: 'Sample',
      week: 'This week',
      store: 'LOCAL GROCER',
      items: [
        { n: 'Milk 2L', p: '6.49', tag: 'EXEMPT' },
        { n: 'Eggs 12', p: '5.99', tag: 'EXEMPT' },
        { n: 'Dish soap', p: '4.29', tag: 'GST+PST' },
        { n: 'Coffee', p: '18.99', tag: 'GST' },
      ],
      subtotal: 'Subtotal',
      total: 'Total',
      scanned: '4 items read · tax split',
      cats: [
        { n: 'Meat', v: '28%' },
        { n: 'Vegetables', v: '22%' },
        { n: 'Staples', v: '18%' },
        { n: 'Dining out', v: '17%' },
        { n: 'Household', v: '9%' },
        { n: 'Other', v: '6%' },
      ],
      ledger: [
        { who: 'M', what: 'Local Grocer · Vegetables', amt: '$37.01' },
        { who: 'D', what: 'Gas station · Other', amt: '$68.40' },
        { who: 'S', what: 'Stationery · Other', amt: '$12.85' },
      ],
    },
  },
};
