// 识别提示词里与 #28 相关的两条规则(合计税按 5:7 拆分、小费作为明细)。不调用 OpenRouter，不连数据库。
import { describe, it, expect } from 'vitest';
import openrouterLib from '../src/openrouter.cjs';

describe('buildPrompt() 税与小费规则', () => {
  const prompt = openrouterLib.buildPrompt();

  it('只印一行合计税时要求按 5:7 拆成 gst 和 pst', () => {
    expect(prompt).toContain('5:7');
    expect(prompt).toContain('5/12');
    expect(prompt).toContain('7/12');
  });

  it('分别印了 GST/PST 的小票按印出的填(不再拆)', () => {
    expect(prompt).toContain('按印出的填');
  });

  it('小费行作为 category 其他、taxable false 的明细，并计入 subtotal', () => {
    expect(prompt).toMatch(/小费[\s\S]*其他[\s\S]*taxable 为 false/);
    expect(prompt).toContain('subtotal + gst + pst = total');
  });

  it('分类白名单仍来自 config', () => {
    for (const c of openrouterLib.config.categories) expect(prompt).toContain(c);
  });
});
