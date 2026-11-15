// scanReceipt 的可选 onMeta 钩子(评测用): 不改返回结构，只把 API 的 usage/model/耗时交给钩子。fetch 被替换，不会真的调用 OpenRouter。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import openrouterLib from '../src/openrouter.cjs';

const content = JSON.stringify({ store: 'Costco', purchased_at: '2026-10-14', subtotal: 10, gst: 0.5, pst: 0.7, total: 11.2, items: [{ name_raw: 'X', amount: 10, qty: 1, taxable: true }] });
const upstream = { id: 'gen-1', model: 'google/gemini-2.5-flash', provider: 'Google', choices: [{ message: { content } }], usage: { prompt_tokens: 1200, completion_tokens: 80, total_tokens: 1280, cost: 0.00042 } };

let calls;
beforeEach(() => {
  calls = [];
  process.env.OPENROUTER_API_KEY = 'sk-or-test-invalid';
  vi.stubGlobal('fetch', vi.fn(async (url, init) => { calls.push(JSON.parse(init.body)); return { ok: true, json: async () => upstream }; }));
});
afterEach(() => vi.unstubAllGlobals());

describe('scanReceipt onMeta', () => {
  it('不带钩子: 返回只有 receipt/items/raw，请求体不带 usage 开关(App 的请求不变)', async () => {
    const res = await openrouterLib.scanReceipt('data:image/jpeg;base64,AAAA');
    expect(Object.keys(res).sort()).toEqual(['items', 'raw', 'receipt']);
    expect(res.receipt.total).toBe(11.2);
    expect(calls[0].usage).toBeUndefined();
  });

  it('带钩子: 返回结构相同，钩子收到 usage/model/id 与耗时，请求体要求返回 usage', async () => {
    const meta = [];
    const res = await openrouterLib.scanReceipt('data:image/jpeg;base64,AAAA', { onMeta: (m) => meta.push(m) });
    expect(Object.keys(res).sort()).toEqual(['items', 'raw', 'receipt']);
    expect(meta.length).toBe(1);
    expect(meta[0].usage).toEqual(upstream.usage);
    expect(meta[0].model).toBe('google/gemini-2.5-flash');
    expect(meta[0].id).toBe('gen-1');
    expect(meta[0].provider).toBe('Google');
    expect(typeof meta[0].ms).toBe('number');
    expect(calls[0].usage).toEqual({ include: true });
  });

  it('上游没给 usage 时钩子收到 null，不抛错', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ...upstream, usage: undefined }) })));
    const meta = [];
    await openrouterLib.scanReceipt('data:image/jpeg;base64,AAAA', { onMeta: (m) => meta.push(m) });
    expect(meta[0].usage).toBeNull();
  });

  it('模型返回的不是 JSON 时照旧抛错，但钩子已经拿到这次计费调用的 usage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ...upstream, choices: [{ message: { content: '看不清' } }] }) })));
    const meta = [];
    await expect(openrouterLib.scanReceipt('data:image/jpeg;base64,AAAA', { onMeta: (m) => meta.push(m) })).rejects.toThrow(/未找到 JSON/);
    expect(meta[0].usage).toEqual(upstream.usage);
  });

  it('上游返回非 2xx 时抛错且不调用钩子(没有可记的 usage)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, text: async () => 'rate limited' })));
    const meta = [];
    await expect(openrouterLib.scanReceipt('data:image/jpeg;base64,AAAA', { onMeta: (m) => meta.push(m) })).rejects.toThrow(/429/);
    expect(meta.length).toBe(0);
  });
});
