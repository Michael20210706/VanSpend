// Q22: 单张图片不超过 10 MB，超出返回 413，且不会调用 OpenRouter / 不落盘
import fs from 'fs';
import { describe, it, expect, vi } from 'vitest';
import openrouterLib from '@/src/openrouter.cjs';
import * as scanRoute from '@/app/api/scan/route.js';
import * as receiptsRoute from '@/app/api/receipts/route.js';
import { makeUser, loginAs, req } from './helpers.js';

// base64 每 4 个字符解码成 3 字节
const imageOfBytes = (bytes) => 'data:image/jpeg;base64,' + 'A'.repeat(Math.ceil(bytes / 3) * 4);
const MB = 1024 * 1024;
const receiptBody = (image) => ({
  receipt: { store: 'T', purchased_at: '2026-05-01', currency: 'CAD', subtotal: 1, gst: 0, pst: 0, total: 1 },
  items: [{ name_raw: 'A', name_norm: 'a', category: '其他', subcategory: null, qty: 1, unit: null, unit_price: 1, amount: 1, taxable: 0 }],
  image,
});

describe('上传大小限制', () => {
  it('识别接口: 超过 10 MB → 413，不调用 OpenRouter', async () => {
    await loginAs(await makeUser());
    // 必须 mock: 即使限制失效，也绝不能在测试里真的调用(计费的)OpenRouter
    const spy = vi.spyOn(openrouterLib, 'scanReceipt').mockResolvedValue({ receipt: {}, items: [], raw: {} });
    const res = await scanRoute.POST(req('/api/scan', { method: 'POST', body: { image: imageOfBytes(10 * MB + 3) } }));
    expect(res.status).toBe(413);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('识别接口: 不超过 10 MB 会正常交给 OpenRouter', async () => {
    await loginAs(await makeUser());
    const spy = vi.spyOn(openrouterLib, 'scanReceipt').mockResolvedValue({ receipt: {}, items: [], raw: {} });
    const res = await scanRoute.POST(req('/api/scan', { method: 'POST', body: { image: imageOfBytes(10 * MB - 3) } }));
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it('保存接口: 超过 10 MB → 413，不落盘', async () => {
    await loginAs(await makeUser());
    const before = fs.readdirSync(process.env.UPLOAD_DIR).length;
    const res = await receiptsRoute.POST(req('/api/receipts', { method: 'POST', body: receiptBody(imageOfBytes(10 * MB + 3)) }));
    expect(res.status).toBe(413);
    expect(fs.readdirSync(process.env.UPLOAD_DIR).length).toBe(before);
  });

  it('保存接口: image 不是字符串(如数组包一层)→ 400，不落盘', async () => {
    await loginAs(await makeUser());
    const before = fs.readdirSync(process.env.UPLOAD_DIR).length;
    const res = await receiptsRoute.POST(req('/api/receipts', { method: 'POST', body: receiptBody([imageOfBytes(1000)]) }));
    expect(res.status).toBe(400);
    expect(fs.readdirSync(process.env.UPLOAD_DIR).length).toBe(before);
  });

  it('识别接口: image 不是字符串 → 400，不调用 OpenRouter', async () => {
    await loginAs(await makeUser());
    const spy = vi.spyOn(openrouterLib, 'scanReceipt').mockResolvedValue({ receipt: {}, items: [], raw: {} });
    const res = await scanRoute.POST(req('/api/scan', { method: 'POST', body: { image: [imageOfBytes(1000)] } }));
    expect(res.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('请求体超过上限(未解析前就拒绝) → 413', async () => {
    await loginAs(await makeUser());
    const spy = vi.spyOn(openrouterLib, 'scanReceipt').mockResolvedValue({ receipt: {}, items: [], raw: {} });
    const res = await scanRoute.POST(req('/api/scan', { method: 'POST', body: { image: imageOfBytes(1000), pad: 'x'.repeat(17 * MB) } }));
    expect(res.status).toBe(413);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('非图片类型的 data URL(html / svg)→ 400，不落盘', async () => {
    await loginAs(await makeUser());
    const before = fs.readdirSync(process.env.UPLOAD_DIR).length;
    for (const type of ['html', 'svg+xml']) {
      const res = await receiptsRoute.POST(req('/api/receipts', { method: 'POST', body: receiptBody(`data:image/${type};base64,AAAA`) }));
      expect(res.status).toBe(400);
    }
    expect(fs.readdirSync(process.env.UPLOAD_DIR).length).toBe(before);
  });

  it('请求体是合法 JSON 但不是对象(null / 数组)→ 400，不是 500', async () => {
    await loginAs(await makeUser());
    for (const raw of ['null', '[1,2]', '42']) {
      expect((await scanRoute.POST(req('/api/scan', { method: 'POST', body: raw }))).status).toBe(400);
    }
  });

  it('保存接口: 小图正常保存 → 200', async () => {
    await loginAs(await makeUser());
    const res = await receiptsRoute.POST(req('/api/receipts', { method: 'POST', body: receiptBody(imageOfBytes(1000)) }));
    expect(res.status).toBe(200);
  });
});
