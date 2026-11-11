// eval/score.cjs 的单元测试: 纯函数，不连数据库，不调用 OpenRouter
import { describe, it, expect } from 'vitest';
import scoreLib from '../eval/score.cjs';

const { scoreReceipt, aggregate, wilson, storeMatch, matchItems } = scoreLib;
const CATS = ['肉类', '其他'];

const truth = {
  store: 'T&T Supermarket', date: '2026-10-02',
  items: [
    { name: 'A', qty: 1, amount: 10.0, taxable: false },
    { name: 'B', qty: 2, amount: 7.98, taxable: true },
    { name: 'Tip', qty: 1, amount: 5.0, taxable: false, is_tip: true },
  ],
  subtotal: 22.98, gst: 0.4, pst: 0.56, total: 23.94,
};
const good = () => ({
  receipt: { store: 'T&T', purchased_at: '2026-10-02', subtotal: 22.98, gst: 0.4, pst: 0.56, total: 23.94 },
  items: [
    { amount: 10, qty: 1, taxable: 0, category: '肉类' },
    { amount: 7.98, qty: 2, taxable: 1, category: '其他' },
    { amount: 5, qty: 1, taxable: 0, category: '其他' },
  ],
});

describe('scoreReceipt', () => {
  it('完全正确 -> fullyCorrect', () => {
    const s = scoreReceipt(truth, good(), CATS);
    expect(s.fullyCorrect).toBe(true);
    expect(s.tp).toBe(3);
    expect(s.tipFound).toBe(true);
    expect(s.consistent).toBe(true);
  });

  it('#28: 合计税没拆(gst=pst=0)且 total 对不上 -> 不 fullyCorrect, 拆分/合计/一致性都判错', () => {
    const p = good();
    p.receipt.gst = 0; p.receipt.pst = 0;
    const s = scoreReceipt(truth, p, CATS);
    expect(s.fullyCorrect).toBe(false);
    expect(s.gstOk).toBe(false);
    expect(s.pstOk).toBe(false);
    expect(s.taxSumOk).toBe(false);
    expect(s.consistent).toBe(false);
    expect(s.totalOk).toBe(true);
  });

  it('GST+PST 之和对但拆分错 -> taxSumOk 为真, gstOk/pstOk 为假', () => {
    const p = good();
    p.receipt.gst = 0.96; p.receipt.pst = 0;
    const s = scoreReceipt(truth, p, CATS);
    expect(s.taxSumOk).toBe(true);
    expect(s.gstOk).toBe(false);
  });

  it('漏掉小费行 -> tipFound=false, 召回下降, 明细数不符', () => {
    const p = good();
    p.items.pop();
    const s = scoreReceipt(truth, p, CATS);
    expect(s.tipFound).toBe(false);
    expect(s.tp).toBe(2);
    expect(s.countOk).toBe(false);
    expect(s.fullyCorrect).toBe(false);
  });

  it('qty / taxable 错只在匹配到的行上计错', () => {
    const p = good();
    p.items[1].taxable = 0;
    p.items[0].qty = 3;
    const s = scoreReceipt(truth, p, CATS);
    expect(s.tp).toBe(3);
    expect(s.qtyOk).toBe(2);
    expect(s.taxableOk).toBe(2);
  });

  it('金额 ±0.01 内算匹配, 超出不算', () => {
    const p = good();
    p.items[0].amount = 10.01;
    p.items[1].amount = 8.0;
    const s = scoreReceipt(truth, p, CATS);
    expect(s.tp).toBe(2);
  });

  it('非白名单分类不计入 categoryValid', () => {
    const p = good();
    p.items[0].category = '随便';
    expect(aggregate([scoreReceipt(truth, p, CATS)]).categoryValid.k).toBe(2);
  });

  it('日期/商家错 -> 对应字段为假', () => {
    const p = good();
    p.receipt.purchased_at = '2026-10-03';
    p.receipt.store = '未知';
    const s = scoreReceipt(truth, p, CATS);
    expect(s.dateOk).toBe(false);
    expect(s.storeOk).toBe(false);
  });

  it('非小票: 空明细为正确, 有明细为错误, 且不进小票比例指标', () => {
    const nt = { store: '', date: '', items: [], subtotal: 0, gst: 0, pst: 0, total: 0 };
    const ok = scoreReceipt(nt, { receipt: {}, items: [] }, CATS);
    const bad = scoreReceipt(nt, { receipt: {}, items: [{ amount: 1 }] }, CATS);
    expect(ok.fullyCorrect).toBe(true);
    expect(bad.fullyCorrect).toBe(false);
    const agg = aggregate([ok, bad, scoreReceipt(truth, good(), CATS)]);
    expect(agg.receipts).toBe(1);
    expect(agg.nonReceipt).toEqual({ n: 2, emptyOk: 1 });
  });
});

describe('helpers', () => {
  it('storeMatch 归一化与包含', () => {
    expect(storeMatch('T&T Supermarket', 't&t supermarket')).toBe(true);
    expect(storeMatch('T&T Supermarket', 'T&T')).toBe(true);
    expect(storeMatch('Costco', 'Safeway')).toBe(false);
    expect(storeMatch('大统华超市', '大统华')).toBe(true);
    expect(storeMatch('Costco', '未知')).toBe(false);
    expect(storeMatch('Costco', '')).toBe(false);
  });

  it('matchItems 一对一: 两条同金额只能配两条', () => {
    const t = [{ amount: 5, qty: 1 }, { amount: 5, qty: 1 }, { amount: 5, qty: 1 }];
    const p = [{ amount: 5, qty: 1 }, { amount: 5, qty: 1 }];
    expect(matchItems(t, p).length).toBe(2);
  });

  it('wilson 区间: 已知值', () => {
    const w = wilson(8, 10);
    expect(w.p).toBe(0.8);
    expect(w.lo).toBeCloseTo(0.4902, 3);
    expect(w.hi).toBeCloseTo(0.9433, 3);
    expect(wilson(0, 0).p).toBeNull();
    const z = wilson(0, 5);
    expect(z.lo).toBe(0);
    expect(z.hi).toBeCloseTo(0.4345, 3);
  });

  it('聚合: 明细 P/R/F1', () => {
    const p = good();
    p.items.pop();
    p.items.push({ amount: 99, qty: 1, taxable: 0, category: '其他' });
    const a = aggregate([scoreReceipt(truth, p, CATS)]);
    expect(a.items.tp).toBe(2);
    expect(a.items.precision.p).toBeCloseTo(2 / 3);
    expect(a.items.recall.p).toBeCloseTo(2 / 3);
    expect(a.items.f1).toBeCloseTo(2 / 3);
  });
});
