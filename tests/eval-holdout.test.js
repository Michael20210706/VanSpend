// eval/build-holdout.cjs 的单元测试: 纯函数，不写文件，不连数据库，不调用 OpenRouter
import { describe, it, expect } from 'vitest';
import { generateHoldout, GROUP_MIX } from '../eval/build-holdout.cjs';
import ds from '../eval/dataset.json';

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

describe('generateHoldout', () => {
  const a = generateHoldout({ seed: 7, label: 'holdout' });

  it('同一种子两次生成完全一致，不同种子不同', () => {
    expect(JSON.stringify(generateHoldout({ seed: 7, label: 'holdout' }))).toBe(JSON.stringify(a));
    expect(JSON.stringify(generateHoldout({ seed: 8, label: 'holdout' }))).not.toBe(JSON.stringify(a));
  });

  it('12 张，组的构成与首轮数据集的六类各 2 张一致，id 带标签且不与 dataset.json 撞名', () => {
    expect(a.receipts.length).toBe(12);
    const counts = {};
    for (const r of a.receipts) counts[r.group] = (counts[r.group] || 0) + 1;
    expect(counts).toEqual(GROUP_MIX);
    const existing = new Set(ds.receipts.map((r) => r.id));
    for (const r of a.receipts) {
      expect(r.id.startsWith('holdout-')).toBe(true);
      expect(existing.has(r.id)).toBe(false);
    }
    expect(new Set(a.receipts.map((r) => r.id)).size).toBe(12);
  });

  it('每张的答案自洽: subtotal = 明细之和, total = subtotal + gst + pst, 税按 E/G/T 标记算', () => {
    for (const r of a.receipts) {
      const t = r.truth;
      expect(r2(t.items.reduce((s, i) => s + i.amount, 0))).toBe(t.subtotal);
      expect(r2(t.subtotal + t.gst + t.pst)).toBe(t.total);
      expect(/^\d{4}-\d{2}-\d{2}$/.test(t.date)).toBe(true);
      expect(t.items.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('印刷行里能找到总计金额与每条明细的金额(渲染出来的图和答案对得上)', () => {
    for (const r of a.receipts) {
      const printed = r.lines.map((l) => (l.r || '') + ' ' + (l.l || '')).join('\n');
      expect(printed).toContain(r.truth.total.toFixed(2));
      for (const i of r.truth.items) expect(printed).toContain(Math.abs(i.amount).toFixed(2));
    }
  });

  it('各组带上该组的特征: 合计税只印一行, 餐厅有小费行, 折扣组有负数行与称重行, 中文组用中文, 降质组有画面效果', () => {
    const by = (g) => a.receipts.filter((r) => r.group === g);
    for (const r of by('tnt-combined')) {
      expect(r.lines.some((l) => /^(GST 5%|PST 7%)$/.test(l.l))).toBe(false);
      expect(r.truth.gst + r.truth.pst).toBeGreaterThan(0);
    }
    for (const r of by('restaurant-tip')) {
      expect(r.truth.items.some((i) => i.is_tip)).toBe(true);
      expect(r.printed.tip).toBeGreaterThan(0);
    }
    for (const r of by('discount-weighed')) {
      expect(r.truth.items.some((i) => i.amount < 0)).toBe(true);
      expect(r.lines.some((l) => /\d (kg|lb) @/.test(l.l))).toBe(true);
    }
    for (const r of by('chinese')) expect(/[一-鿿]/.test(r.truth.store)).toBe(true);
    for (const r of by('degraded')) expect(Object.keys(r.effects).length).toBeGreaterThan(0);
    for (const r of by('costco')) expect(r.lines.some((l) => /A=GST/.test(l.l))).toBe(true);
  });
});
