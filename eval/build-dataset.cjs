'use strict';
// 生成 eval/dataset.json: 合成小票的"已知答案"(truth) + 渲染用的印刷行(lines) + 画面效果(effects)。
// 用法: node eval/build-dataset.cjs   然后: swiftc -O eval/render.swift -o /tmp/render && /tmp/render eval/dataset.json eval/images
// 税规则(合成数据按小票自身印出的为准，不代表 BC 税法的全部细节):
//   flag E = 免税, G = 仅 GST 5%, T = GST 5% + PST 7%。折扣行沿用所属商品的 flag。
const fs = require('fs');
const path = require('path');

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const money = (n) => (n < 0 ? Math.abs(n).toFixed(2) + '-' : n.toFixed(2));

// item: [印刷名, 数量, 单价或 {amt}, flag, 选项{unit,note,cat}]
function makeTruth(items, opts = {}) {
  const rows = items.map(([name, qty, up, flag, o = {}]) => {
    const amount = o.amt != null ? o.amt : r2(qty * up);
    return { name, qty, up, flag, amount, unit: o.unit || '', pr: o.pr || name, note: o.note };
  });
  let gstBase = 0, pstBase = 0, sub = 0;
  for (const x of rows) {
    sub += x.amount;
    if (x.flag === 'G' || x.flag === 'T') gstBase += x.amount;
    if (x.flag === 'T') pstBase += x.amount;
  }
  const tip = opts.tip || 0;
  const gst = r2(gstBase * 0.05);
  const pst = r2(pstBase * 0.07);
  const subtotalItems = r2(sub + tip);
  return { rows, gst, pst, printedSubtotal: r2(sub), tip, subtotal: subtotalItems, total: r2(subtotalItems + gst + pst) };
}

function truthJson(store, date, t) {
  const items = t.rows.map((x) => ({ name: x.name, qty: x.qty, amount: x.amount, taxable: x.flag !== 'E' }));
  if (t.tip) items.push({ name: 'Tip', qty: 1, amount: t.tip, taxable: false, is_tip: true });
  return { store, date, items, subtotal: t.subtotal, gst: t.gst, pst: t.pst, total: t.total };
}

const FLAGCH = { costco: { E: '', G: 'A', T: 'B' }, std: { E: '', G: 'G', T: 'GP' }, tnt: { E: '', G: 'T', T: 'T' } };

function itemLines(t, style) {
  const out = [];
  for (const x of t.rows) {
    const fl = FLAGCH[style === 'costco' ? 'costco' : style === 'tnt' ? 'tnt' : 'std'][x.flag];
    const amt = money(x.amount);
    if (style === 'costco') out.push({ l: `${fl || ' '} ${String(100000 + out.length * 7919 % 900000)} ${x.pr}`, r: amt });
    else if (style === 'tnt') out.push({ l: x.pr, r: amt + (fl ? ' ' + fl : '') });
    else out.push({ l: x.pr, r: amt + (fl ? ' ' + fl : '') });
    if (x.unit === 'kg' || x.unit === 'lb') out.push({ l: `   ${x.qty} ${x.unit} @ ${x.up.toFixed(2)}/${x.unit}`, s: 0.85 });
    else if (x.qty !== 1) out.push({ l: `   ${x.qty} @ ${x.up.toFixed(2)}`, s: 0.85 });
  }
  return out;
}

function receipt(spec) {
  const { id, group, features = [], store, date, datePrint, addr = [], style, taxMode, items, tip = 0, effects = {}, font, cjk = false, extraHeader = [], tipLabel = 'Tip' } = spec;
  const t = makeTruth(items, { tip });
  const L = [];
  L.push({ l: store.print || store, align: 'c', b: true, s: 1.35 });
  for (const a of addr) L.push({ l: a, align: 'c', s: 0.85 });
  for (const h of extraHeader) L.push({ l: h, align: 'c', s: 0.85 });
  L.push({ l: datePrint || date, align: 'c', s: 0.9, gap: 6 });
  L.push({ l: '-'.repeat(30), align: 'c', s: 0.9 });
  L.push(...itemLines(t, style));
  L.push({ l: '-'.repeat(30), align: 'c', s: 0.9 });
  const k = cjk ? ['小计', '商品税', '联邦税 GST 5%', '省税 PST 7%', '总计', '小费'] : ['SUBTOTAL', 'TAX', 'GST 5%', 'PST 7%', 'TOTAL', tipLabel.toUpperCase()];
  if (taxMode === 'combined') {
    const label = spec.taxLabel || k[1];
    L.push({ l: cjk ? '小计' : 'Subtotal', r: money(t.printedSubtotal) });
    L.push({ l: label, r: money(r2(t.gst + t.pst)) });
    L.push({ l: k[4], r: money(t.total), b: true, s: 1.15 });
  } else {
    L.push({ l: cjk ? '小计' : 'Subtotal', r: money(t.printedSubtotal) });
    if (t.gst || taxMode !== 'gstOnlyHide') L.push({ l: k[2], r: money(t.gst) });
    if (taxMode === 'separate' || t.pst) L.push({ l: k[3], r: money(t.pst) });
    if (t.tip) L.push({ l: k[5], r: money(t.tip) });
    L.push({ l: k[4], r: money(t.total), b: true, s: 1.15 });
  }
  if (style === 'costco') L.push({ l: 'A=GST  B=GST+PST', align: 'c', s: 0.8, gap: 4 });
  if (style === 'std' && taxMode !== 'combined') L.push({ l: 'G=GST  GP=GST+PST', align: 'c', s: 0.8, gap: 4 });
  if (style === 'tnt') L.push({ l: 'T = Taxable', align: 'c', s: 0.8, gap: 4 });
  L.push({ l: spec.footer || (cjk ? '谢谢惠顾' : 'THANK YOU'), align: 'c', s: 0.9, gap: 6 });
  const dm = /(\d\d)\/(\d\d)\/\d{4}/.exec(datePrint || '');
  const dateAmbiguous = !!dm && +dm[1] <= 12 && +dm[2] <= 12 && dm[1] !== dm[2];
  return { id, group, features, dateAmbiguous, width: spec.width || 520, font: font || (cjk ? 'PingFangSC-Regular' : 'Menlo-Regular'), effects, lines: L, truth: truthJson(store.name || store, date, t), printed: { subtotal: t.printedSubtotal, tip: t.tip } };
}

const E = 'E', G = 'G', T = 'T';
const specs = [];
const add = (s) => specs.push(s);

// 1-2 Costco, 分开印 GST/PST
add({ id: 'costco-01', group: 'costco', store: 'Costco', date: '2026-10-14', datePrint: '10/14/2026 14:32', addr: ['Burnaby #148', '4500 Still Creek Dr'], style: 'costco', taxMode: 'separate',
  items: [['KS EGGS 24CT', 1, 11.99, E], ['KS BUTTER', 2, 13.49, E, { pr: 'KS SALTED BUTTER' }], ['ORG BANANAS', 1, 2.99, E], ['SOFTSOAP 6PK', 1, 17.99, T], ['LAUNDRY PODS', 1, 24.99, T], ['VITAMIN D 600', 1, 15.99, G], ['COKE 35PK', 1, 19.49, T]] });
add({ id: 'costco-02', group: 'costco', store: 'Costco', date: '2026-09-03', datePrint: '09/03/2026 11:05', addr: ['Vancouver #1500', '605 Hastings St'], style: 'costco', taxMode: 'separate',
  items: [['RIBEYE STEAK', 1.842, 21.98, E, { unit: 'kg', pr: 'KS BEEF RIBEYE' }], ['CHICKEN BRST', 1, 17.88, E], ['SOCKEYE FILLET', 1, 29.96, E], ['PAPER TOWEL 12', 1, 26.99, T], ['TOOTHPASTE 4PK', 1, 14.99, T], ['MILK 4L', 1, 6.89, E], ['RICE 20LB', 1, 28.99, E], ['CHIPS VARIETY', 1, 15.49, T]] });

// 3-6 T&T 只印一行合计税 (#28)
add({ id: 'tnt-01', group: 'tnt-combined', features: ['combined_tax'], store: 'T&T Supermarket', date: '2026-10-02', datePrint: 'Oct 2, 2026  18:21', addr: ['Richmond Store', '8181 Cambie Rd'], style: 'tnt', taxMode: 'combined', taxLabel: 'TAX',
  items: [['PORK BELLY SLICED', 1.12, 8.99, E, { unit: 'lb' }], ['BOK CHOY', 0.86, 2.49, E, { unit: 'lb' }], ['LAY\'S CHIPS', 2, 3.99, T], ['SOY MILK', 1, 3.49, T], ['TISSUE 12RL', 1, 12.99, T], ['TOFU FIRM', 2, 2.29, E]] });
add({ id: 'tnt-02', group: 'tnt-combined', features: ['combined_tax'], store: 'T&T Supermarket', date: '2026-08-21', datePrint: '2026-08-21 12:47', addr: ['Metrotown', '4700 Kingsway'], style: 'tnt', taxMode: 'combined', taxLabel: 'Sales Tax',
  items: [['GREEN TEA 500ML', 4, 1.99, T], ['INSTANT NOODLE 5PK', 2, 5.99, E], ['DISH SOAP', 1, 4.49, T], ['SHRIMP FROZEN', 1, 14.99, E], ['COOKIES', 3, 2.79, T], ['EGG 12CT', 1, 4.99, E]] });
add({ id: 'tnt-03', group: 'tnt-combined', features: ['combined_tax'], store: 'T&T Supermarket', date: '2026-11-01', datePrint: '11/01/2026 16:09', addr: ['Coquitlam', '1200 Pinetree Way'], style: 'tnt', taxMode: 'combined', taxLabel: 'TAX (GST+PST)',
  items: [['BEEF SHORT RIB', 2.31, 12.99, E, { unit: 'lb' }], ['SPARKLING WATER 12PK', 1, 7.99, T], ['SHAMPOO', 1, 9.99, T], ['MANDARIN ORANGE', 1, 6.99, E], ['SNACK MIX', 2, 4.49, T], ['BREAD SLICED', 1, 3.99, E], ['CANDY ASSORTED', 1, 5.49, T]] });
add({ id: 'tnt-04', group: 'tnt-combined', features: ['combined_tax'], store: 'T&T Supermarket', date: '2026-07-18', datePrint: 'Jul 18, 2026 10:30', addr: ['Vancouver', '179 Keefer Pl'], style: 'tnt', taxMode: 'combined', taxLabel: 'Tax',
  items: [['BUBBLE TEA KIT', 1, 11.99, T], ['TAPIOCA PEARLS', 1, 4.99, T], ['MILK 2L', 1, 5.49, E], ['PLASTIC WRAP', 1, 6.49, T], ['DUMPLINGS PORK', 2, 9.99, E]] });

// 7-9 餐厅小费
add({ id: 'rest-01', group: 'restaurant-tip', features: ['tip'], store: 'Golden Palace Restaurant', date: '2026-09-27', datePrint: '2026-09-27 19:14  Table 12', addr: ['Richmond, BC'], style: 'std', taxMode: 'gstOnly', cjk: false, tip: 9.5,
  items: [['Hot & Sour Soup', 1, 8.5, G], ['Kung Pao Chicken', 1, 19.0, G], ['Beef Chow Fun', 1, 18.5, G], ['Steamed Rice', 2, 2.0, G], ['Jasmine Tea', 2, 2.5, G]] });
add({ id: 'rest-02', group: 'restaurant-tip', features: ['tip'], store: 'Pasta Bella', date: '2026-10-09', datePrint: 'Oct 9, 2026  7:42 PM', addr: ['Gastown, Vancouver'], style: 'std', taxMode: 'gstOnly', tip: 12.0,
  items: [['Caesar Salad', 1, 11.0, G], ['Spaghetti Carbonara', 1, 22.0, G], ['Margherita Pizza', 1, 20.0, G], ['Tiramisu', 1, 10.0, G], ['Sparkling Water', 1, 6.5, G]] });
add({ id: 'rest-03', group: 'restaurant-tip', features: ['tip'], store: 'Sushi Garden', date: '2026-08-15', datePrint: '2026-08-15 12:20', addr: ['Burnaby, BC'], style: 'std', taxMode: 'gstOnly', tip: 7.2, tipLabel: 'Gratuity',
  items: [['Salmon Sashimi', 1, 16.0, G], ['Dragon Roll', 1, 14.5, G], ['Miso Soup', 2, 3.0, G], ['Chicken Teriyaki', 1, 15.5, G]] });

// 10-12 折扣/称重
add({ id: 'disc-01', group: 'discount-weighed', features: ['discount', 'weighed'], store: 'Real Canadian Superstore', date: '2026-10-20', datePrint: '2026-10-20 09:58', addr: ['Marine Drive', 'Vancouver, BC'], style: 'std', taxMode: 'separate',
  items: [['CHICKEN THIGH', 1.318, 7.7, E, { unit: 'kg' }], ['BANANAS', 0.905, 1.74, E, { unit: 'kg' }], ['DETERGENT', 1, 15.99, T], ['PC INSTANT SAVINGS', 1, 0, T, { amt: -3.0, pr: 'DETERGENT COUPON' }], ['YOGURT 650G', 2, 4.49, E]] });
add({ id: 'disc-02', group: 'discount-weighed', features: ['discount', 'weighed'], store: 'Save-On-Foods', date: '2026-09-11', datePrint: '09/11/2026 17:40', addr: ['Kitsilano', 'Vancouver BC'], style: 'std', taxMode: 'separate',
  items: [['SALMON FILLET', 0.612, 24.99, E, { unit: 'kg' }], ['GRAPES RED', 0.734, 5.5, E, { unit: 'kg' }], ['POTATO CHIPS', 1, 5.99, T], ['CHIPS SALE', 1, 0, T, { amt: -1.5, pr: 'SALE DISCOUNT' }], ['BREAD', 1, 4.29, E], ['SPARKLING JUICE', 3, 2.99, T]] });
add({ id: 'disc-03', group: 'discount-weighed', features: ['discount'], store: 'Walmart', date: '2026-11-05', datePrint: '11/05/2026 13:15', addr: ['Supercentre #3055', 'Surrey, BC'], style: 'std', taxMode: 'separate',
  items: [['KIDS T-SHIRT', 2, 8.0, G], ['LUNCH BOX', 1, 14.97, T], ['ROLLBACK', 1, 0, T, { amt: -2.0, pr: 'ROLLBACK LUNCH BOX' }], ['CEREAL', 1, 5.47, E], ['NOTEBOOK 3PK', 1, 6.97, T]] });

// 13-15 中文小票
add({ id: 'cn-01', group: 'chinese', features: ['chinese'], store: '大统华超市', date: '2026-09-18', datePrint: '2026年9月18日 15:36', addr: ['列治文店'], style: 'std', taxMode: 'separate', cjk: true,
  items: [['五花肉 (斤)', 1.35, 6.99, E, { unit: 'lb' }], ['上海青', 1, 3.29, E], ['豆腐', 2, 2.19, E], ['酱油 1L', 1, 5.99, E], ['卫生纸 12卷', 1, 11.99, T], ['可乐 6罐', 1, 5.49, T]] });
add({ id: 'cn-02', group: 'chinese', features: ['chinese'], store: '华美海鲜酒楼', date: '2026-10-05', datePrint: '2026年10月5日 18:50', addr: ['本拿比'], style: 'std', taxMode: 'gstOnly', cjk: true, tip: 8.0, tipLabel: '小费',
  items: [['清蒸鲈鱼', 1, 38.0, G], ['蒜蓉粉丝蒸扇贝', 1, 22.0, G], ['炒时蔬', 1, 14.0, G], ['白饭', 3, 1.5, G]] });
add({ id: 'cn-03', group: 'chinese', features: ['chinese'], store: '百汇生鲜超市', date: '2026-11-08', datePrint: '2026年11月8日', addr: ['温哥华 Kingsway'], style: 'std', taxMode: 'separate', cjk: true,
  items: [['鲜虾仁', 1, 12.99, E], ['鸡蛋 12枚', 1, 4.99, E], ['牛奶 2L', 1, 5.29, E], ['方便面', 4, 1.29, E], ['洗洁精', 1, 3.99, T], ['维生素C', 1, 12.99, G], ['大米 10kg', 1, 22.99, E]] });

// 16-18 GST-only / PST 豁免 混合
add({ id: 'mix-01', group: 'mixed-tax', features: ['gst_only'], store: 'Shoppers Drug Mart', date: '2026-08-30', datePrint: '2026-08-30 10:12', addr: ['West Broadway', 'Vancouver, BC'], style: 'std', taxMode: 'separate',
  items: [['VITAMIN C 500MG', 1, 14.99, G], ['MULTIVITAMIN', 1, 21.99, G], ['SHAMPOO 400ML', 1, 8.99, T], ['MILK 2%', 1, 4.99, E], ['BREAD', 1, 3.49, E]] });
add({ id: 'mix-02', group: 'mixed-tax', features: ['gst_only'], store: 'Safeway', date: '2026-10-25', datePrint: 'Oct 25, 2026 08:49', addr: ['Granville St', 'Vancouver, BC'], style: 'std', taxMode: 'separate',
  items: [['KIDS SOCKS 5PK', 1, 9.99, G], ['APPLES GALA', 1, 5.49, E], ['COOKIES CHOC', 1, 4.99, T], ['CHEESE CHEDDAR', 1, 8.49, E], ['GREETING CARD', 1, 4.5, G], ['SODA 12PK', 1, 7.99, T]] });
add({ id: 'mix-03', group: 'mixed-tax', features: ['gst_only'], store: 'London Drugs', date: '2026-09-07', datePrint: '09/07/2026 14:03', addr: ['Oakridge', 'Vancouver, BC'], style: 'std', taxMode: 'separate',
  items: [['CHILD BOOK', 1, 12.99, G], ['FISH OIL', 1, 18.99, G], ['BATTERIES AA 8PK', 1, 11.99, T], ['EGGS 18CT', 1, 6.99, E], ['ORANGE JUICE', 1, 4.79, E]] });

// 19-22 降质
add({ id: 'deg-01', group: 'degraded', features: ['tilt_noise'], store: 'Safeway', date: '2026-10-12', datePrint: '10/12/2026 19:01', addr: ['Main St', 'Vancouver, BC'], style: 'std', taxMode: 'separate',
  effects: { rotate: 4.5, noise: 0.08, blur: 0.8, light: 0.35, desk: true },
  items: [['CHICKEN WINGS', 1, 9.99, E], ['TORTILLA CHIPS', 1, 4.49, T], ['SALSA', 1, 3.99, E], ['LIME 3CT', 1, 1.5, E], ['DISH SOAP', 1, 3.79, T]] });
add({ id: 'deg-02', group: 'degraded', features: ['low_contrast'], store: 'Superstore', date: '2026-08-04', datePrint: '2026-08-04 20:20', addr: ['Kingsway'], style: 'std', taxMode: 'separate',
  effects: { contrast: 0.45, noise: 0.05, light: 0.25, blur: 0.5 },
  items: [['BUTTER 454G', 1, 6.49, E], ['PASTA SAUCE', 2, 2.99, E], ['SPAGHETTI', 2, 1.99, E], ['PAPER PLATES', 1, 4.99, T], ['CANDY BAG', 1, 3.49, T]] });
add({ id: 'deg-03', group: 'degraded', features: ['photo_like'], store: 'Costco', date: '2026-09-29', datePrint: '09/29/2026 16:44', addr: ['Richmond #1521'], style: 'costco', taxMode: 'separate',
  effects: { rotate: -3.0, persp: 0.06, noise: 0.07, blur: 1.1, light: 0.5, desk: true, jpeg: 0.55 },
  items: [['KS WATER 40PK', 1, 4.99, E], ['ROTISSERIE CHICKEN', 1, 7.99, E], ['TRASH BAGS', 1, 18.99, T], ['TOMATOES', 1, 6.49, E], ['KS COFFEE', 1, 24.99, E]] });
add({ id: 'deg-04', group: 'degraded', features: ['small_dim'], store: 'Walmart', date: '2026-10-31', datePrint: '10/31/2026 21:10', addr: ['Langley, BC'], style: 'std', taxMode: 'separate', width: 360,
  effects: { rotate: -2.0, noise: 0.1, blur: 1.2, light: 0.3, contrast: 0.7, desk: true, jpeg: 0.5 },
  items: [['HALLOWEEN CANDY', 2, 8.97, T], ['PUMPKIN', 1, 5.0, E], ['COSTUME KIDS', 1, 19.97, G], ['BATTERIES', 1, 7.97, T]] });

// 23-24 长小票
const longItems1 = [['BANANAS', 1, 1.99, E], ['AVOCADO 4CT', 1, 5.99, E], ['SPINACH', 1, 3.99, E], ['CHICKEN BREAST', 1, 12.5, E], ['GROUND BEEF', 1, 9.49, E], ['MILK 4L', 1, 6.19, E], ['EGGS 12', 1, 4.79, E], ['YOGURT', 2, 3.49, E], ['CEREAL', 1, 5.99, E], ['PASTA', 3, 1.89, E], ['PASTA SAUCE', 2, 2.99, E], ['COFFEE', 1, 11.99, E], ['POTATO CHIPS', 2, 4.49, T], ['COLA 12PK', 1, 8.99, T], ['TOILET PAPER', 1, 13.99, T], ['DISH SOAP', 1, 3.99, T], ['SHAMPOO', 1, 7.49, T], ['VITAMIN D', 1, 11.99, G]];
add({ id: 'long-01', group: 'long', features: ['long'], store: 'Superstore', date: '2026-10-18', datePrint: '2026-10-18 11:22', addr: ['Marine Drive', 'Vancouver, BC'], style: 'std', taxMode: 'separate', items: longItems1 });
const longItems2 = [['KS CHICKEN BREAST', 1, 18.99, E], ['KS BACON', 1, 12.99, E], ['SALMON FILLET', 1, 22.5, E], ['KS TORTILLAS', 1, 6.99, E], ['ROMAINE 6CT', 1, 5.99, E], ['KS BUTTER', 1, 13.49, E], ['CHEESE BLOCK', 1, 12.99, E], ['KS COFFEE', 1, 24.99, E], ['GREEK YOGURT', 1, 9.99, E], ['STRAWBERRIES', 1, 7.99, E], ['BLUEBERRIES', 1, 8.49, E], ['KS OLIVE OIL', 1, 17.99, E], ['PAPER TOWEL', 1, 26.99, T], ['LAUNDRY SOAP', 1, 22.99, T], ['SNACK BARS', 1, 15.99, T], ['SPARKLING WATER', 1, 11.99, T]];
add({ id: 'long-02', group: 'long', features: ['long'], store: 'Costco', date: '2026-11-02', datePrint: '11/02/2026 12:08', addr: ['Burnaby #148'], style: 'costco', taxMode: 'separate', items: longItems2 });

const out = specs.map(receipt);

// 25 非小票
out.push({ id: 'nonreceipt-01', group: 'non-receipt', features: ['non_receipt'], width: 520, font: 'Helvetica', effects: { noise: 0.03 }, nonreceipt: true,
  lines: [{ l: 'Happy Birthday!', align: 'c', b: true, s: 2.2, gap: 30 }, { l: 'Wishing you a wonderful day', align: 'c', s: 1.0 }, { l: 'Party at 5 pm, Saturday', align: 'c', s: 1.0, gap: 20 }, { l: 'Bring a friend', align: 'c', s: 1.0 }],
  truth: { store: '', date: '', items: [], subtotal: 0, gst: 0, pst: 0, total: 0 } });

const ds = { generated_by: 'eval/build-dataset.cjs', receipts: out };
fs.writeFileSync(path.join(__dirname, 'dataset.json'), JSON.stringify(ds, null, 1));
console.log('receipts', out.length);
for (const r of out) console.log(r.id.padEnd(14), r.truth.items.length, 'sub', r.truth.subtotal, 'gst', r.truth.gst, 'pst', r.truth.pst, 'tot', r.truth.total);
