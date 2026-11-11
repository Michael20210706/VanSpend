// Q18: 原图只有上传者本人、同家庭成员、管理员能看，其余一律 404
import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeAll } from 'vitest';
import * as uploadsRoute from '@/app/uploads/[...file]/route.js';
import { makeUser, makeFamily, makeReceipt, loginAs, logout, req, ctx, uniq } from './helpers.js';

const get = (name) => uploadsRoute.GET(req('/uploads/' + name), ctx({ file: name.split('/') }));

describe('/uploads 原图鉴权', () => {
  let owner, member, stranger, admin, file, privateFile;
  beforeAll(async () => {
    owner = await makeUser();
    member = await makeUser();
    stranger = await makeUser();
    admin = await makeUser({ admin: true });
    const familyId = await makeFamily(owner, member);

    file = uniq('img') + '.jpg';
    fs.writeFileSync(path.join(process.env.UPLOAD_DIR, file), Buffer.from('fake-jpeg'));
    await makeReceipt(owner, { familyId, imageFile: file });

    privateFile = uniq('img') + '.png';
    fs.writeFileSync(path.join(process.env.UPLOAD_DIR, privateFile), Buffer.from('fake-png'));
    await makeReceipt(owner, { imageFile: privateFile }); // 个人小票(无 family_id)
  });

  it('上传者本人 → 200，且禁止缓存', async () => {
    await loginAs(owner);
    const res = await get(file);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toMatch(/private/);
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
  });

  it('同家庭成员看家庭小票的图 → 200', async () => {
    await loginAs(member);
    expect((await get(file)).status).toBe(200);
  });

  it('同家庭成员看对方的个人小票的图 → 404', async () => {
    await loginAs(member);
    expect((await get(privateFile)).status).toBe(404);
  });

  it('管理员 → 200', async () => {
    await loginAs(admin);
    expect((await get(privateFile)).status).toBe(200);
  });

  it('无关用户 → 404', async () => {
    await loginAs(stranger);
    expect((await get(file)).status).toBe(404);
  });

  it('无关用户看个人小票的图 → 404(两边 family_id 都为空不能算"同家庭")', async () => {
    await loginAs(stranger);
    expect((await get(privateFile)).status).toBe(404);
  });

  it('另一个家庭的成员看本家庭的图 → 404', async () => {
    const otherCreator = await makeUser();
    await makeFamily(otherCreator);
    await loginAs(otherCreator);
    expect((await get(file)).status).toBe(404);
  });

  it('未登录 → 404', async () => {
    logout();
    expect((await get(file)).status).toBe(404);
  });

  it('磁盘上有文件但不属于任何小票 → 404', async () => {
    const orphan = uniq('orphan') + '.jpg';
    fs.writeFileSync(path.join(process.env.UPLOAD_DIR, orphan), Buffer.from('x'));
    await loginAs(admin);
    expect((await get(orphan)).status).toBe(404);
  });

  it('所有 404 也带 Cache-Control: private, no-store(Cloudflare 会缓存无该头的 404)', async () => {
    const orphan = uniq('orphan') + '.jpg';
    fs.writeFileSync(path.join(process.env.UPLOAD_DIR, orphan), Buffer.from('x'));
    const expectNoStore = (res) => {
      expect(res.status).toBe(404);
      expect(res.headers.get('cache-control')).toBe('private, no-store');
    };
    logout();
    expectNoStore(await get(file)); // 未登录
    await loginAs(stranger);
    expectNoStore(await get(file)); // 无权
    await loginAs(admin);
    expectNoStore(await get(orphan)); // 不属于任何小票
    expectNoStore(await get('nope-' + uniq('x') + '.jpg')); // 不存在
    expectNoStore(await get('../package.json')); // 非法名字
    await loginAs(owner);
    fs.unlinkSync(path.join(process.env.UPLOAD_DIR, file));
    expectNoStore(await get(file)); // 库里有、磁盘上没有
    fs.writeFileSync(path.join(process.env.UPLOAD_DIR, file), Buffer.from('fake-jpeg'));
  });

  it('路径穿越 → 404', async () => {
    await loginAs(admin);
    expect((await get('../package.json')).status).toBe(404);
    expect((await get('..%2Fpackage.json')).status).toBe(404);
    expect((await get('sub/' + file)).status).toBe(404);
  });
});
