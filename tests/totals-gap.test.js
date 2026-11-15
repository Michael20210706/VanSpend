// lib/totalsGap.js: 核对界面的"明细合计 + 税 ≠ 实付"提示
import { describe, it, expect } from 'vitest';
import { totalsGap, gapIsMismatch } from '@/lib/totalsGap.js';

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
