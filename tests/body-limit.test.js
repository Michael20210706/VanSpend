// 其余需要登录的接口也有 16 KB 请求体上限(readJson)，超过 → 413，且不进入业务逻辑
import { describe, it, expect } from 'vitest';
import * as passwordRoute from '@/app/api/auth/password/route.js';
import * as feedbackRoute from '@/app/api/feedback/route.js';
import * as familyRoute from '@/app/api/family/route.js';
import * as applyRoute from '@/app/api/family/apply/route.js';
import * as inviteRoute from '@/app/api/family/invite/route.js';
import * as decideRoute from '@/app/api/family/requests/[id]/route.js';
import { makeUser, makeFamily, loginAs, req, ctx } from './helpers.js';

const big = { content: 'x'.repeat(20 * 1024) };

describe('登录后接口的请求体上限', () => {
  it.each([
    ['修改密码', () => passwordRoute.POST],
    ['提交反馈', () => feedbackRoute.POST],
    ['创建家庭', () => familyRoute.POST],
    ['申请加入家庭', () => applyRoute.POST],
  ])('%s: 超过 16 KB → 413', async (_name, getHandler) => {
    await loginAs(await makeUser());
    const res = await getHandler()(req('/x', { method: 'POST', body: big }));
    expect(res.status).toBe(413);
  });

  it('邀请成员(创建者): 超过 16 KB → 413', async () => {
    const creator = await makeUser();
    await makeFamily(creator);
    await loginAs(creator);
    expect((await inviteRoute.POST(req('/x', { method: 'POST', body: big }))).status).toBe(413);
  });

  it('审核申请(创建者): 超过 16 KB → 413', async () => {
    const creator = await makeUser();
    await makeFamily(creator);
    await loginAs(creator);
    expect((await decideRoute.POST(req('/x', { method: 'POST', body: big }), ctx({ id: '1' }))).status).toBe(413);
  });

  it('正常大小的反馈仍可提交 → 200', async () => {
    await loginAs(await makeUser());
    expect((await feedbackRoute.POST(req('/api/feedback', { method: 'POST', body: { content: '很好用' } }))).status).toBe(200);
  });
});
