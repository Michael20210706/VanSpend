// lib/totalsGap.js: 核对界面的"明细合计 + 税 ≠ 实付"提示
import { describe, it, expect } from 'vitest';
import { totalsGap, gapIsMismatch, taxOverCeiling } from '@/lib/totalsGap.js';

describe('totalsGap', () => {
  const rows = [{ amount: 15 }, { amount: '5' }];
  it('对得上 → 0，不算对不上', () => {
    expect(totalsGap(rows, 0.25, 1.25, 21.5)).toBe(0);
    expect(gapIsMismatch(0)).toBe(false);
  });
  it('实付多出 9.5(漏了小费或删掉了差额行) → 9.5，算对不上', () => {
    expect(totalsGap(rows, 0.25, 1.25, 31)).toBe(9.5);
    expect(gapIsMismatch(9.5)).toBe(true);
  });
  it('明细多读了一行 → 负数，也算对不上', () => {
    expect(totalsGap([...rows, { amount: 3 }], 0.25, 1.25, 21.5)).toBe(-3);
    expect(gapIsMismatch(-3)).toBe(true);
  });
  it('2 分以内的取整差不算对不上；超过 2 分才算', () => {
    expect(gapIsMismatch(totalsGap(rows, 0.25, 1.25, 21.52))).toBe(false);
    expect(gapIsMismatch(totalsGap(rows, 0.25, 1.25, 21.53))).toBe(true);
  });
  it('没有明细、没填实付、输入框里是空串或非数字 → 0，不报', () => {
    expect(totalsGap([], 0, 0, 10)).toBe(0);
    expect(totalsGap(rows, 0, 0, 0)).toBe(0);
    expect(totalsGap(rows, '', '', '')).toBe(0);
    expect(totalsGap([{ amount: 'abc' }], 0, 0, 10)).toBe(10);
  });
});

// BC 的 GST 固定 5%，PST 最高 10%(酒类)；超过明细合计(正数行)的这个比例不可能是真的税，多半是把小费等算进了税
describe('taxOverCeiling', () => {
  const dishes = [{ amount: 120 }, { amount: 62.61 }];
  it('小费被填进 pst(pst 远超 10%) → pst 报出', () => {
    expect(taxOverCeiling(dishes, 9.13, 29.93)).toEqual({ gst: false, pst: true });
  });
  it('gst 超过 5% → gst 报出', () => {
    expect(taxOverCeiling([{ amount: 100 }], 7, 0)).toEqual({ gst: true, pst: false });
  });
  it('正常的 5% / 7%、酒类 10% PST 都不报', () => {
    expect(taxOverCeiling([{ amount: 100 }], 5, 7)).toEqual({ gst: false, pst: false });
    expect(taxOverCeiling([{ amount: 100 }], 5, 10)).toEqual({ gst: false, pst: false });
  });
  it('上限按正数行合计算：大额折扣行不会让正常税额被误报', () => {
    expect(taxOverCeiling([{ amount: 100 }, { amount: -60 }], 5, 7)).toEqual({ gst: false, pst: false });
  });
  it('5 分以内的取整不报；没有明细或输入为空串不报', () => {
    expect(taxOverCeiling([{ amount: 100 }], 5.05, 10.05)).toEqual({ gst: false, pst: false });
    expect(taxOverCeiling([{ amount: 100 }], 5.06, 10.06)).toEqual({ gst: true, pst: true });
    expect(taxOverCeiling([], 5, 7)).toEqual({ gst: false, pst: false });
    expect(taxOverCeiling([{ amount: '100' }], '', '')).toEqual({ gst: false, pst: false });
  });
});
