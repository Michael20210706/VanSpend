// eval/models.cjs 的纯函数: 中位数、费用取值、H-M 验收判定。不连数据库，不调用 OpenRouter
import { describe, it, expect } from 'vitest';
import { median, costOf, decide, RULE } from '../eval/models.cjs';

describe('median', () => {
  it('奇数个取中间，偶数个取中间两个的平均，忽略 null/NaN，全空返回 null', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([null, 5, NaN, 1])).toBe(3);
    expect(median([])).toBeNull();
    expect(median([null])).toBeNull();
  });
});

describe('costOf', () => {
  it('API 返回 cost 时用它，标"测量"', () => {
    expect(costOf({ prompt_tokens: 1000, completion_tokens: 100, cost: 0.00042 }, 'flash')).toEqual({ cost: 0.00042, source: '测量' });
  });
  it('没有 cost 时按标价估算，标"推断"', () => {
    const c = costOf({ prompt_tokens: 1_000_000, completion_tokens: 1_000_000 }, 'flash-lite');
    expect(c.source).toBe('推断');
    expect(c.cost).toBeCloseTo(0.5, 10);
  });
  it('没有 usage 或缺 token 数时不给数字', () => {
    expect(costOf(null, 'flash')).toEqual({ cost: null, source: null });
    expect(costOf({ prompt_tokens: 10 }, 'flash')).toEqual({ cost: null, source: null });
  });
});

describe('decide (H-M 验收规则)', () => {
  it('规则常量与文档一致: 多 3 张、费用 2 倍', () => {
    expect(RULE).toEqual({ minExtraFullyCorrect: 3, maxCostRatio: 2 });
  });
  it('多 3 张且费用正好 2 倍: 建议切换', () => {
    expect(decide({ liteFull: 4, flashFull: 7, liteCost: 0.001, flashCost: 0.002 })).toMatchObject({ extra: 3, accuracyOk: true, costOk: true, recommendSwitch: true });
  });
  it('只多 2 张: 不建议，即使更便宜', () => {
    expect(decide({ liteFull: 4, flashFull: 6, liteCost: 0.001, flashCost: 0.0005 })).toMatchObject({ extra: 2, accuracyOk: false, costOk: true, recommendSwitch: false });
  });
  it('多 3 张但费用超过 2 倍: 不建议', () => {
    expect(decide({ liteFull: 4, flashFull: 9, liteCost: 0.001, flashCost: 0.00201 })).toMatchObject({ accuracyOk: true, costOk: false, recommendSwitch: false });
  });
  it('费用缺失: 无法验证，不建议', () => {
    expect(decide({ liteFull: 4, flashFull: 9, liteCost: null, flashCost: 0.002 })).toMatchObject({ accuracyOk: true, costOk: null, ratio: null, recommendSwitch: false });
  });
  it('flash 更差: 差值为负，不建议', () => {
    expect(decide({ liteFull: 6, flashFull: 5, liteCost: 0.001, flashCost: 0.001 })).toMatchObject({ extra: -1, recommendSwitch: false });
  });
});
