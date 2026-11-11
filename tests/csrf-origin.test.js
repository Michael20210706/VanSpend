// issue #37: CSRF 只靠 SameSite=Lax。写请求(非 GET/HEAD/OPTIONS)带了与本站不同的 Origin，或浏览器声明是跨站请求，一律 403
import { describe, it, expect } from 'vitest';
import { wrap } from '@/src/http';
import * as feedbackRoute from '@/app/api/feedback/route.js';
import { makeUser, loginAs } from './helpers.js';

const handler = wrap(async () => Response.json({ ok: true }));
const call = (method, headers = {}) =>
  handler(new Request('http://app.test/api/x', { method, headers: { host: 'www.example.com', ...headers } }), {});

describe('写请求的来源校验(wrap)', () => {
  it('Origin 与 Host 同源 → 放行(含经 Cloudflare 的 https 与带端口的本地地址)', async () => {
    expect((await call('POST', { origin: 'https://www.example.com' })).status).toBe(200);
    expect((await call('POST', { origin: 'http://www.example.com' })).status).toBe(200);
    expect((await call('POST', { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' })).status).toBe(200);
  });
  it('X-Forwarded-Host 与 Origin 同源也放行', async () => {
    expect((await call('POST', { host: 'internal:3000', 'x-forwarded-host': 'www.example.com', origin: 'https://www.example.com' })).status).toBe(200);
  });
  it('Origin 是别的站、同主机的另一个端口、子域名、或 "null" → 403', async () => {
    for (const origin of ['https://evil.test', 'https://www.example.com:8443', 'https://x.www.example.com', 'null', 'not a url']) {
      const res = await call('POST', { origin });
      expect(res.status, origin).toBe(403);
      expect((await res.json()).error).toBeTruthy();
    }
  });
  it('PUT、PATCH、DELETE 同样校验', async () => {
    for (const m of ['PUT', 'PATCH', 'DELETE']) {
      expect((await call(m, { origin: 'https://evil.test' })).status).toBe(403);
      expect((await call(m, { origin: 'https://www.example.com' })).status).toBe(200);
    }
  });
  it('没有 Origin: 没带 Sec-Fetch-Site(curl、脚本)放行；same-origin、none 放行；cross-site、same-site 拒绝', async () => {
    expect((await call('POST')).status).toBe(200);
    expect((await call('POST', { 'sec-fetch-site': 'same-origin' })).status).toBe(200);
    expect((await call('POST', { 'sec-fetch-site': 'none' })).status).toBe(200);
    expect((await call('POST', { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await call('POST', { 'sec-fetch-site': 'same-site' })).status).toBe(403);
  });
  it('GET、HEAD、OPTIONS 不校验(读请求不改状态)', async () => {
    for (const m of ['GET', 'HEAD', 'OPTIONS']) {
      expect((await call(m, { origin: 'https://evil.test' })).status).toBe(200);
    }
  });
});

describe('真实路由: 跨站写请求被拦在业务逻辑之前', () => {
  it('带别的站的 Origin 提交反馈 → 403，什么都没写；同源 → 200', async () => {
    const u = await makeUser();
    await loginAs(u);
    const post = (origin) => feedbackRoute.POST(new Request('http://localhost/api/feedback', {
      method: 'POST', headers: { 'content-type': 'application/json', host: 'localhost', origin }, body: JSON.stringify({ content: '来自测试的反馈内容' }),
    }));
    expect((await post('https://evil.test')).status).toBe(403);
    expect((await post('http://localhost')).status).toBe(200);
  });
});

describe('每个写接口都经过 wrap()', () => {
  it('app/api 下没有未包 wrap 的 POST/PUT/PATCH/DELETE 导出', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const files = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name === 'route.js') files.push(p); } };
    walk(path.join(process.cwd(), 'app'));
    expect(files.length).toBeGreaterThan(30);
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      const writes = (src.match(/export (async function|const) (POST|PUT|PATCH|DELETE)\b/g) || []).length;
      const wrapped = (src.match(/export const (POST|PUT|PATCH|DELETE) = wrap\(/g) || []).length;
      expect(wrapped, f).toBe(writes);
    }
  });
});
