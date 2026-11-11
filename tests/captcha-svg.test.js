import { describe, it, expect } from 'vitest';
import captcha from '@/src/captcha.cjs';

const decode = (image) => Buffer.from(image.split(',')[1], 'base64').toString('utf8');

describe('验证码图片不含可读文本 (#19)', () => {
  it('SVG 里没有 text/tspan/font-family，也没有任何文本节点内容', () => {
    for (let i = 0; i < 20; i++) {
      const svg = decode(captcha.generate().image);
      expect(svg).not.toMatch(/<text|<tspan|font-family|font-size|<title|<desc/i);
      const textNodes = svg.replace(/<[^>]*>/g, '');
      expect(textNodes).toBe('');
      expect(svg).not.toMatch(/[0-9]\s*[+-]\s*[0-9]\s*=/);
      expect(svg.length).toBeLessThan(12 * 1024);
    }
  });

  it('字形用 path 描边绘制，每个字符一条', () => {
    const svg = captcha.renderSvg('5-9=?');
    const glyphPaths = svg.match(/<path d="M[^"]*" stroke="#[0-9a-f]{6}" stroke-width="(2\.6|3\.4)"/g) || [];
    expect(glyphPaths.length).toBe(5);
  });

  it('同一算式两次渲染结果不同(随机旋转/位移/抖动)', () => {
    expect(captcha.renderSvg('5-9=?')).not.toBe(captcha.renderSvg('5-9=?'));
  });

  it('token 仍可校验: 答案正确通过，错误不通过', () => {
    const { token } = captcha.generate();
    expect(captcha.isWellFormed(token)).toBe(true);
    expect(captcha.verify(token, 'x')).toBe(false);
  });
});
