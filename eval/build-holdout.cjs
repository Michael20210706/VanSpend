'use strict';
// 生成"保留集"(held-out): 用固定随机种子从商家/商品/日期写法/画面效果的表里抽样，拼成与首轮同样六类、各 2 张的 12 张合成小票，
// 答案与印刷行由 build-dataset.cjs 的 receipt() 生成(同一套税规则)。目的是得到一组写规则时没见过的小票，降低"调到目标上"的乐观偏差。
// 用法: node eval/build-holdout.cjs [--seed 20261114] [--label holdout]   -> eval/dataset-holdout.json
//       然后: swiftc -O eval/render.swift -o /tmp/render && /tmp/render eval/dataset-holdout.json eval/images   (图片 holdout-*.jpg)
// 生成后不要按模型的失败样本调整这里的表或种子。
const fs = require('fs');
const path = require('path');
const { receipt, makeTruth, E, G, T } = require('./build-dataset.cjs');

const GROUP_MIX = { costco: 2, 'tnt-combined': 2, 'restaurant-tip': 2, 'discount-weighed': 2, chinese: 2, degraded: 2 };

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// 商品表: [印刷名, 价格区间, 税标记, 选项{unit}]。unit 为 kg/lb 的是称重商品
const COSTCO = [['KS EGGS 24CT', [9.99, 13.99], E], ['KS BUTTER', [12.49, 14.99], E], ['ORG BANANAS', [2.49, 3.49], E], ['KS ALMONDS', [15.99, 19.99], E], ['ROTISSERIE CHKN', [7.99, 7.99], E], ['KS BACON', [11.99, 14.99], E], ['BLUEBERRIES', [6.99, 9.49], E], ['KS OLIVE OIL', [16.99, 19.99], E], ['MILK 4L', [6.29, 6.99], E], ['CHICKEN BRST', [15.99, 21.99], E], ['KS BEEF RIBEYE', [18.99, 24.99], E, { unit: 'kg' }], ['SALMON ATLANTIC', [22.99, 29.99], E, { unit: 'kg' }],
  ['PAPER TOWEL 12', [24.99, 27.99], T], ['LAUNDRY PODS', [22.99, 26.99], T], ['TOOTHPASTE 4PK', [13.99, 15.99], T], ['TRASH BAGS', [17.99, 19.99], T], ['DISH SOAP 2PK', [11.99, 13.99], T], ['SPARKLING WATER', [10.99, 12.99], T], ['CHIPS VARIETY', [14.99, 16.99], T], ['BATTERIES AA 48', [19.99, 22.99], T],
  ['VITAMIN D 600', [14.99, 16.99], G], ['FISH OIL 400', [19.99, 24.99], G], ['KIDS SOCKS 6PK', [12.99, 14.99], G]];
const TNT = [['PORK BELLY SLICED', [7.99, 9.99], E, { unit: 'lb' }], ['BOK CHOY', [1.99, 2.99], E, { unit: 'lb' }], ['GAI LAN', [2.49, 3.49], E, { unit: 'lb' }], ['BEEF SHORT RIB', [11.99, 13.99], E, { unit: 'lb' }], ['TOFU FIRM', [1.99, 2.49], E], ['INSTANT NOODLE 5PK', [4.99, 6.49], E], ['SHRIMP FROZEN', [12.99, 15.99], E], ['EGG 12CT', [4.49, 5.49], E], ['MANDARIN ORANGE', [5.99, 7.99], E], ['BREAD SLICED', [3.49, 4.29], E], ['DUMPLINGS PORK', [8.99, 10.99], E], ['RICE 8KG', [19.99, 24.99], E],
  ["LAY'S CHIPS", [3.49, 4.29], T], ['SOY MILK', [2.99, 3.79], T], ['TISSUE 12RL', [11.99, 13.99], T], ['DISH SOAP', [3.99, 4.99], T], ['COOKIES', [2.49, 3.29], T], ['SPARKLING WATER 12PK', [6.99, 8.49], T], ['SHAMPOO', [8.99, 10.99], T], ['GREEN TEA 500ML', [1.79, 2.29], T], ['SNACK MIX', [3.99, 4.99], T], ['CANDY ASSORTED', [4.99, 5.99], T]];
const GROCERY = [['CHICKEN THIGH', [6.99, 8.49], E, { unit: 'kg' }], ['BANANAS', [1.59, 1.89], E, { unit: 'kg' }], ['GRAPES RED', [4.99, 6.49], E, { unit: 'kg' }], ['SALMON FILLET', [22.99, 27.99], E, { unit: 'kg' }], ['APPLES GALA', [3.49, 4.49], E, { unit: 'kg' }], ['YOGURT 650G', [3.99, 4.99], E], ['BREAD', [3.49, 4.49], E], ['MILK 2L', [4.79, 5.49], E], ['EGGS 12CT', [4.29, 5.29], E], ['CHEESE CHEDDAR', [7.99, 9.49], E], ['PASTA SAUCE', [2.79, 3.49], E], ['CEREAL', [4.99, 6.49], E], ['BUTTER 454G', [5.99, 6.99], E], ['ORANGE JUICE', [4.49, 5.29], E],
  ['DETERGENT', [13.99, 16.99], T], ['POTATO CHIPS', [4.49, 5.99], T], ['SPARKLING JUICE', [2.49, 3.49], T], ['PAPER PLATES', [4.49, 5.49], T], ['CANDY BAG', [2.99, 3.99], T], ['TOILET PAPER', [12.99, 14.99], T], ['SHAMPOO', [6.99, 8.49], T], ['COLA 12PK', [7.99, 9.49], T], ['DISH SOAP', [3.49, 4.29], T], ['LUNCH BOX', [12.97, 15.97], T],
  ['KIDS T-SHIRT', [7.0, 9.0], G], ['VITAMIN C 500MG', [12.99, 15.99], G], ['CHILD BOOK', [9.99, 13.99], G]];
const REST_EN = [['Hot & Sour Soup', [7.5, 9.5], G], ['Kung Pao Chicken', [17.0, 20.0], G], ['Beef Chow Fun', [16.5, 19.5], G], ['Steamed Rice', [1.5, 2.5], G], ['Jasmine Tea', [2.0, 3.0], G], ['Caesar Salad', [10.0, 13.0], G], ['Spaghetti Carbonara', [19.0, 24.0], G], ['Margherita Pizza', [18.0, 22.0], G], ['Tiramisu', [8.5, 11.0], G], ['Sparkling Water', [5.0, 7.0], G], ['Salmon Sashimi', [14.0, 18.0], G], ['Dragon Roll', [13.0, 16.0], G], ['Miso Soup', [2.5, 3.5], G], ['Chicken Teriyaki', [14.0, 17.0], G], ['Pad Thai', [15.0, 18.0], G], ['Green Curry', [16.0, 19.0], G], ['Butter Chicken', [17.0, 21.0], G], ['Garlic Naan', [3.5, 4.5], G], ['Fish Tacos', [15.0, 18.0], G], ['Lemonade', [3.5, 4.5], G]];
const REST_CN = [['清蒸鲈鱼', [36.0, 42.0], G], ['蒜蓉粉丝蒸扇贝', [20.0, 24.0], G], ['炒时蔬', [12.0, 16.0], G], ['白饭', [1.5, 2.0], G], ['宫保鸡丁', [16.0, 19.0], G], ['麻婆豆腐', [13.0, 16.0], G], ['酸辣汤', [8.0, 10.0], G], ['干炒牛河', [16.0, 19.0], G], ['北京烤鸭(半只)', [32.0, 38.0], G], ['小笼包', [9.0, 12.0], G], ['茉莉花茶', [2.0, 3.0], G], ['椒盐虾', [22.0, 26.0], G]];
const CN_GROCERY = [['五花肉 (斤)', [5.99, 7.49], E, { unit: 'lb' }], ['上海青', [2.99, 3.79], E], ['豆腐', [1.99, 2.49], E], ['酱油 1L', [4.99, 6.49], E], ['鲜虾仁', [11.99, 13.99], E], ['鸡蛋 12枚', [4.49, 5.49], E], ['牛奶 2L', [4.99, 5.69], E], ['方便面', [1.19, 1.49], E], ['大米 10kg', [21.99, 25.99], E], ['排骨 (斤)', [6.49, 8.49], E, { unit: 'lb' }], ['青椒', [1.99, 2.99], E], ['冷冻饺子', [8.99, 10.99], E],
  ['卫生纸 12卷', [10.99, 12.99], T], ['可乐 6罐', [4.99, 5.99], T], ['洗洁精', [3.49, 4.49], T], ['薯片', [3.49, 4.29], T], ['洗发水', [8.99, 10.99], T], ['纸巾 6包', [6.99, 8.49], T],
  ['维生素C', [11.99, 14.99], G], ['儿童袜 3双', [7.99, 9.99], G]];

const STORES = {
  costco: [['Costco', ['Burnaby #148', '4500 Still Creek Dr']], ['Costco', ['Vancouver #1500', '605 Hastings St']], ['Costco', ['Richmond #1521', '9151 Bridgeport Rd']], ['Costco', ['Coquitlam #1536', '1105 Lougheed Hwy']]],
  tnt: [['T&T Supermarket', ['Richmond Store', '8181 Cambie Rd']], ['T&T Supermarket', ['Metrotown', '4700 Kingsway']], ['T&T Supermarket', ['Coquitlam', '1200 Pinetree Way']], ['T&T Supermarket', ['Vancouver', '179 Keefer Pl']], ['T&T Supermarket', ['Surrey Central', '10153 King George Blvd']]],
  restEn: [['Golden Palace Restaurant', ['Richmond, BC']], ['Pasta Bella', ['Gastown, Vancouver']], ['Sushi Garden', ['Burnaby, BC']], ['Thai Orchid', ['Kitsilano, Vancouver']], ['Spice Route', ['Surrey, BC']], ['Harbour Grill', ['Coal Harbour, Vancouver']]],
  grocery: [['Real Canadian Superstore', ['Marine Drive', 'Vancouver, BC']], ['Save-On-Foods', ['Kitsilano', 'Vancouver BC']], ['Walmart', ['Supercentre #3055', 'Surrey, BC']], ['Safeway', ['Granville St', 'Vancouver, BC']], ['Superstore', ['Kingsway']], ['No Frills', ['Hastings St', 'Burnaby, BC']], ['IGA', ['West 4th Ave', 'Vancouver, BC']]],
  cnGrocery: [['大统华超市', ['列治文店']], ['百汇生鲜超市', ['温哥华 Kingsway']], ['丰泰超市', ['本拿比 Crystal Mall']], ['顺发超市', ['列治文 Alexandra Rd']]],
  cnRest: [['华美海鲜酒楼', ['本拿比']], ['金龙轩', ['列治文']], ['老四川', ['温哥华 Cambie St']], ['鼎泰小馆', ['本拿比 Kingsway']]],
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// 日期写法表: 与首轮各组用过的写法同一个池子(含 MM/DD 这种有歧义的写法，不回避)
const DATE_FORMATS = {
  mdy: (d, hm) => `${d.mm}/${d.dd}/${d.y} ${hm}`,
  iso: (d, hm) => `${d.y}-${d.mm}-${d.dd} ${hm}`,
  mon: (d, hm) => `${MONTHS[d.m - 1]} ${d.d}, ${d.y}  ${hm}`,
  cjk: (d, hm) => `${d.y}年${d.m}月${d.d}日 ${hm}`,
};
const FORMAT_POOL = { costco: ['mdy'], tnt: ['mon', 'iso', 'mdy'], rest: ['iso', 'mon'], grocery: ['iso', 'mdy'], cjk: ['cjk'], degraded: ['mdy', 'iso'] };
const TAX_LABELS = ['TAX', 'Sales Tax', 'Tax', 'TAX (GST+PST)', 'Total Tax'];
const TIP_LABELS = ['Tip', 'Gratuity', 'TIP'];
const EFFECTS = [
  { name: 'tilt_noise', fx: { rotate: 4.0, noise: 0.08, blur: 0.8, light: 0.35, desk: true } },
  { name: 'low_contrast', fx: { contrast: 0.45, noise: 0.05, light: 0.25, blur: 0.5 } },
  { name: 'photo_like', fx: { rotate: -3.5, persp: 0.06, noise: 0.07, blur: 1.1, light: 0.5, desk: true, jpeg: 0.55 } },
  { name: 'small_dim', width: 360, fx: { rotate: 2.0, noise: 0.1, blur: 1.2, light: 0.3, contrast: 0.7, desk: true, jpeg: 0.5 } },
];

function generateHoldout({ seed = 20261114, label = 'holdout' } = {}) {
  const rnd = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const price = ([lo, hi]) => r2(lo + rnd() * (hi - lo));
  const sample = (arr, n) => { const a = arr.slice(); const out = []; while (out.length < n && a.length) out.push(a.splice(Math.floor(rnd() * a.length), 1)[0]); return out; };
  const date = () => {
    const y = 2026, m = int(6, 11), d = int(1, m === 11 ? 10 : 28);
    const pad = (n) => String(n).padStart(2, '0');
    return { y, m, d, mm: pad(m), dd: pad(d), iso: `${y}-${pad(m)}-${pad(d)}`, hm: `${pad(int(8, 21))}:${pad(int(0, 59))}` };
  };
  const datePrint = (pool, d) => DATE_FORMATS[pick(FORMAT_POOL[pool])](d, d.hm);
  // 从商品表抽 n 条，称重商品给 3 位小数的重量，其余偶尔给 2–4 的数量
  const draw = (table, n) => sample(table, n).map(([name, range, flag, o = {}]) => {
    if (o.unit) return [name, +(0.4 + rnd() * 2.1).toFixed(3), price(range), flag, { unit: o.unit }];
    return [name, rnd() < 0.2 ? int(2, 4) : 1, price(range), flag];
  });
  const withDiscount = (items) => {
    const taxed = items.map((it, i) => [it, i]).filter(([it]) => it[3] === T);
    const [it, i] = taxed.length ? pick(taxed) : [items[0], 0];
    const amt = -r2(0.5 + rnd() * 2.5);
    items.splice(i + 1, 0, [`${it[0]} DISCOUNT`, 1, 0, it[3], { amt, pr: pick(['COUPON', 'SALE', 'ROLLBACK', 'PC SAVINGS']) + ' ' + it[0] }]);
    return items;
  };
  const tipFor = (items) => r2(makeTruth(items).printedSubtotal * (0.12 + rnd() * 0.06));

  const builders = {
    costco: (i) => { const [store, addr] = pick(STORES.costco); const d = date(); return { id: `${label}-costco-0${i}`, group: 'costco', store, addr, date: d.iso, datePrint: datePrint('costco', d), style: 'costco', taxMode: 'separate', items: draw(COSTCO, int(5, 8)) }; },
    'tnt-combined': (i) => { const [store, addr] = pick(STORES.tnt); const d = date(); return { id: `${label}-tnt-0${i}`, group: 'tnt-combined', features: ['combined_tax'], store, addr, date: d.iso, datePrint: datePrint('tnt', d), style: 'tnt', taxMode: 'combined', taxLabel: pick(TAX_LABELS), items: draw(TNT, int(5, 7)) }; },
    'restaurant-tip': (i) => { const [store, addr] = pick(STORES.restEn); const d = date(); const items = draw(REST_EN, int(4, 6)); return { id: `${label}-rest-0${i}`, group: 'restaurant-tip', features: ['tip'], store, addr, date: d.iso, datePrint: datePrint('rest', d) + (rnd() < 0.5 ? `  Table ${int(2, 24)}` : ''), style: 'std', taxMode: 'gstOnly', tip: tipFor(items), tipLabel: pick(TIP_LABELS), items }; },
    'discount-weighed': (i) => { const [store, addr] = pick(STORES.grocery); const d = date(); const weighed = draw(GROCERY.filter((x) => x[3] && x[3].unit), int(1, 2)); const rest = draw(GROCERY.filter((x) => !x[3] || !x[3].unit), int(3, 5)); return { id: `${label}-disc-0${i}`, group: 'discount-weighed', features: ['discount', 'weighed'], store, addr, date: d.iso, datePrint: datePrint('grocery', d), style: 'std', taxMode: 'separate', items: withDiscount(weighed.concat(rest)) }; },
    chinese: (i) => {
      const d = date();
      if (rnd() < 0.5) { const [store, addr] = pick(STORES.cnGrocery); return { id: `${label}-cn-0${i}`, group: 'chinese', features: ['chinese'], store, addr, date: d.iso, datePrint: datePrint('cjk', d), style: 'std', taxMode: 'separate', cjk: true, items: draw(CN_GROCERY, int(5, 7)) }; }
      const [store, addr] = pick(STORES.cnRest); const items = draw(REST_CN, int(4, 6));
      return { id: `${label}-cn-0${i}`, group: 'chinese', features: ['chinese', 'tip'], store, addr, date: d.iso, datePrint: datePrint('cjk', d), style: 'std', taxMode: 'gstOnly', cjk: true, tip: tipFor(items), tipLabel: '小费', items };
    },
    degraded: (i, effect) => {
      const d = date(); const costcoStyle = rnd() < 0.5;
      const [store, addr] = pick(costcoStyle ? STORES.costco : STORES.grocery);
      return { id: `${label}-deg-0${i}`, group: 'degraded', features: [effect.name], store, addr, date: d.iso, datePrint: datePrint('degraded', d), style: costcoStyle ? 'costco' : 'std', taxMode: 'separate', width: effect.width, effects: effect.fx, items: draw(costcoStyle ? COSTCO : GROCERY, int(4, 6)) };
    },
  };
  const effects = sample(EFFECTS, GROUP_MIX.degraded);
  const out = [];
  for (const [group, n] of Object.entries(GROUP_MIX)) for (let i = 1; i <= n; i++) out.push(receipt(builders[group](i, effects[i - 1])));
  return { generated_by: 'eval/build-holdout.cjs', seed, label, receipts: out };
}

module.exports = { generateHoldout, GROUP_MIX };

if (require.main === module) {
  const arg = (k, dflt) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : dflt);
  const ds = generateHoldout({ seed: Number(arg('--seed', 20261114)), label: arg('--label', 'holdout') });
  const file = path.join(__dirname, `dataset-${ds.label}.json`);
  fs.writeFileSync(file, JSON.stringify(ds, null, 1));
  console.log(file, 'seed', ds.seed, 'receipts', ds.receipts.length);
  for (const r of ds.receipts) console.log(r.id.padEnd(18), r.group.padEnd(16), r.truth.items.length, 'sub', r.truth.subtotal, 'gst', r.truth.gst, 'pst', r.truth.pst, 'tot', r.truth.total, r.dateAmbiguous ? '日期有歧义' : '');
}
