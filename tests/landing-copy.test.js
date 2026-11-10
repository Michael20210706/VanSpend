// P5: 落地页只保留 1a；文案与代码实际行为一致(注册两条路、额度数值、编辑/重复提示、数据归属)；/api/config 不再对匿名开放
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { COPY } from '@/components/landing/copy.js';
import * as configRoute from '@/app/api/config/route.js';
import { makeUser, loginAs, logout, req } from './helpers.js';

const root = process.cwd();
const quota = JSON.parse(fs.readFileSync(path.join(root, 'config/config.json'), 'utf8')).scanQuota;

// 递归取出一个对象的所有"键路径"(数组按长度记)，用来比较 zh / en 的结构
function shape(v, prefix = '') {
  if (Array.isArray(v)) return [`${prefix}[${v.length}]`, ...v.flatMap((x, i) => (typeof x === 'object' ? shape(x, `${prefix}[${i}]`) : []))];
  if (v && typeof v === 'object') return Object.keys(v).sort().flatMap((k) => [prefix + '.' + k, ...shape(v[k], prefix + '.' + k)]);
  return [];
}
const flatText = (v) => JSON.stringify(v);

describe('落地页: 1b 已删除，只剩一个版式', () => {
  it('VariantSwitch 文件不存在，Landing/sections 里没有 variant 分叉', () => {
    expect(fs.existsSync(path.join(root, 'components/landing/VariantSwitch.js'))).toBe(false);
    for (const f of ['Landing.js', 'sections.js', 'mocks.js']) {
      const src = fs.readFileSync(path.join(root, 'components/landing', f), 'utf8');
      expect(src, f).not.toMatch(/variant|VariantSwitch|YearCard|heroB|titleB/);
    }
  });

  it('copy.js 里没有 1b 的 heroB / titleB / titleA 残留，hero/title 是唯一一份', () => {
    for (const lang of ['zh', 'en']) {
      expect(COPY[lang].heroB).toBeUndefined();
      expect(COPY[lang].heroA).toBeUndefined();
      expect(COPY[lang].hero.title.length).toBeGreaterThan(0);
      for (const sec of ['tax', 'insights', 'family', 'cta']) {
        expect(COPY[lang][sec].titleA, `${lang}.${sec}`).toBeUndefined();
        expect(COPY[lang][sec].titleB, `${lang}.${sec}`).toBeUndefined();
        expect(COPY[lang][sec].title.length, `${lang}.${sec}`).toBeGreaterThan(0);
      }
    }
  });

  it('landing.css 里没有 1b 的样式', () => {
    const css = fs.readFileSync(path.join(root, 'components/landing/landing.css'), 'utf8');
    expect(css).not.toMatch(/heroB|yearcard|lp-float|lp-switch|nav--dark|footer--dark|tax-center|family-grid--flip/);
  });

  it('zh 与 en 的结构完全一致(同样的键、同样的数组长度)', () => {
    expect(shape(COPY.en)).toEqual(shape(COPY.zh));
  });
});

describe('落地页文案与实际行为一致', () => {
  it('注册文案: 邀请码或开放注册两条路，额度数字取自 config.scanQuota；不再写"免费"', () => {
    const zh = flatText(COPY.zh);
    const en = flatText(COPY.en);
    expect(zh).toContain('邀请码');
    expect(zh).toContain('开放注册');
    expect(zh).toContain(`每天可识别 ${quota.normal} 张`);
    expect(zh).toContain(`每天可识别 ${quota.open} 张`);
    expect(en).toContain('invite code');
    expect(en).toContain('open sign-up');
    expect(en).toContain(`${quota.normal} receipts a day`);
    expect(en).toContain(`${quota.open} scans a day`);
    expect(zh).not.toMatch(/免费/);
    expect(en).not.toMatch(/free/i);
  });

  it('不再说"保存后只能删掉重录"(P3 起可以编辑)，并提到重复提示', () => {
    expect(flatText(COPY.zh)).not.toContain('只能删掉重录');
    expect(flatText(COPY.en)).not.toContain('only be deleted and re-entered');
    expect(flatText(COPY.zh)).toContain('可能重复');
    expect(flatText(COPY.en)).toContain('possible-duplicate');
  });

  it('数据归属文案如实: 运营者服务器、管理员可见、没有导出；不再说"跑在你自己的机器上"', () => {
    const zh = flatText(COPY.zh);
    const en = flatText(COPY.en);
    expect(zh).not.toContain('你自己的机器');
    expect(zh).not.toContain('你自己的 MySQL');
    expect(en).not.toContain('machine you own');
    expect(zh).toContain('管理员可以查看、删除任何账号的小票');
    expect(en).toContain('site admin can view and delete any account');
    expect(zh).toContain('没有一键导出');
    expect(en).toContain('no one-click export');
  });

  it('不出现代码不支持的宣传: 端到端加密、自动学习分类、导出 CSV', () => {
    const all = flatText(COPY).toLowerCase();
    for (const bad of ['端到端', 'end-to-end', '自动学习', 'csv', '不上传']) expect(all).not.toContain(bad);
  });
});

describe('/api/config 不再对匿名开放', () => {
  it('未登录 401；已登录 200 且带分类', async () => {
    logout();
    expect((await configRoute.GET(req('/api/config'))).status).toBe(401);
    await loginAs(await makeUser());
    const res = await configRoute.GET(req('/api/config'));
    expect(res.status).toBe(200);
    expect((await res.json()).categories.length).toBeGreaterThan(0);
  });
});
