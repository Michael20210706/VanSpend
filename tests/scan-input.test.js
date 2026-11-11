// #23: 识别接口的 base64 前置校验，以及上游错误不透传
import { describe, it, expect, vi, afterEach } from 'vitest';
import openrouterLib from '@/src/openrouter.cjs';
import dbApi from '@/src/db.cjs';
import uploadsLib from '@/src/uploads.cjs';
import * as scanRoute from '@/app/api/scan/route.js';
import { makeUser, loginAs, req } from './helpers.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const scan = (image) => scanRoute.POST(req('/api/scan', { method: 'POST', body: { image } }));
afterEach(() => vi.restoreAllMocks());

describe('checkImage: base64 载荷', () => {
  const bad = {
    '非法字符': 'data:image/png;base64,@@@@',
    '空载荷': 'data:image/png;base64,',
    '长度不是 4 的倍数': 'data:image/png;base64,iVBORw0KGgo',
    '填充位置错误': 'data:image/png;base64,iVB=ORw0KGgo',
    '含空白': 'data:image/png;base64,iVBO Rw0KGgo=',
    '合法 base64 但不是 PNG': 'data:image/png;base64,AAAAAAAAAAAAAAAA',
    '声明 jpeg 实为 png': PNG.replace('image/png', 'image/jpeg'),
  };
  for (const [name, img] of Object.entries(bad)) {
    it(`${name} → 400`, () => expect(uploadsLib.checkImage(img)).toMatchObject({ status: 400 }));
  }
  it('合法 png/jpeg/gif/webp → 通过', () => {
    const b64 = (buf) => buf.toString('base64');
    expect(uploadsLib.checkImage(PNG)).toBeNull();
    expect(uploadsLib.checkImage('data:image/jpeg;base64,' + b64(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])))).toBeNull();
    expect(uploadsLib.checkImage('data:image/gif;base64,' + b64(Buffer.from('GIF89a....')))).toBeNull();
    expect(uploadsLib.checkImage('data:image/webp;base64,' + b64(Buffer.from('RIFF....WEBPVP8 ')))).toBeNull();
  });
});

describe('POST /api/scan', () => {
  it('非法 base64 → 400，不调用上游，不占额度', async () => {
    const u = await makeUser();
    await loginAs(u);
    const spy = vi.spyOn(openrouterLib, 'scanReceipt').mockResolvedValue({ receipt: {}, items: [], raw: {} });
    const res = await scan('data:image/png;base64,@@@@');
    expect(res.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
    const [[c]] = await dbApi.pool.execute('SELECT COUNT(*) c FROM scan_log WHERE user_id = :id', { id: u.id });
    expect(c.c).toBe(0);
  });

  it('上游失败 → 502 统一文案，不含上游原文；scan_log 记为失败；原文进服务端日志', async () => {
    const u = await makeUser();
    await loginAs(u);
    const secret = 'OpenRouter 请求失败 401: Missing Authentication header';
    vi.spyOn(openrouterLib, 'scanReceipt').mockRejectedValue(new Error(secret));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await scan(PNG);
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain('OpenRouter');
    expect(text).not.toContain('Missing Authentication');
    expect(JSON.parse(text).error).toBe('识别服务暂时不可用，请稍后重试');
    expect(log.mock.calls.flat().join(' ')).toContain(secret);
    const [[row]] = await dbApi.pool.execute('SELECT success FROM scan_log WHERE user_id = :id', { id: u.id });
    expect(Number(row.success)).toBe(0);
  });

  it('成功仍为 200 且 scan_log 记为成功', async () => {
    const u = await makeUser();
    await loginAs(u);
    vi.spyOn(openrouterLib, 'scanReceipt').mockResolvedValue({ receipt: {}, items: [], raw: {} });
    expect((await scan(PNG)).status).toBe(200);
    const [[row]] = await dbApi.pool.execute('SELECT success FROM scan_log WHERE user_id = :id', { id: u.id });
    expect(Number(row.success)).toBe(1);
  });
});
