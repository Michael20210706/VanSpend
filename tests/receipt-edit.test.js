// P3: 保存后编辑(仅所有者、按明细重算小计/总额、整体替换明细)与保存前的重复提示(只提示、不拦截)
import { describe, it, expect } from 'vitest';
import dbApi from '@/src/db.cjs';
import * as receiptsRoute from '@/app/api/receipts/route.js';
import * as receiptRoute from '@/app/api/receipts/[id]/route.js';
import * as dupRoute from '@/app/api/receipts/duplicates/route.js';
import * as categoryRoute from '@/app/api/stats/category/route.js';
import { makeUser, makeFamily, loginAs, logout, req, ctx, uniq } from './helpers.js';

const item = (o = {}) => ({
  name_raw: 'Milk', name_norm: '牛奶', category: '乳制品蛋类', subcategory: null,
  qty: 2, unit: null, unit_price: 3, amount: 6, taxable: 0, ...o,
});
const body = (o = {}, items = [item()]) => ({
  receipt: { store: 'Costco', purchased_at: '2026-06-01', gst: 0.5, pst: 0.7, ...o }, items,
});
const put = (id, b) => receiptRoute.PUT(req('/x', { method: 'PUT', body: b }), ctx({ id: String(id) }));
const get = async (id) => (await receiptRoute.GET(req('/x'), ctx({ id: String(id) }))).json();

// 直接写一张带家庭归属/原图/raw_json 的小票(绕过路由，便于对照"没被动过的字段")
async function seed(user, { familyId = null, store = 'Costco', date = '2026-06-01', total = 10, image = 'keep.jpg' } = {}) {
  const fam = familyId ? { family_id: familyId, family_name: 'F', account_type: 'family' } : {};
  return dbApi.saveReceipt(
    { user_id: user.id, ...fam, store, purchased_at: date, currency: 'USD', subtotal: total, gst: 0, pst: 0, total, image_file: image, raw_json: '{"orig":1}' },
    [item({ amount: total, unit_price: total, qty: 1 })]
  );
}

describe('PUT /api/receipts/[id]: 所有者编辑', () => {
  it('能改商家/日期/GST/PST/明细；小计与总额按明细重算，请求体里的 subtotal/total 被忽略', async () => {
    const u = await makeUser();
    const id = await seed(u);
    await loginAs(u);
    const res = await put(id, {
      receipt: { store: '  T&T  ', purchased_at: '2026-06-09', gst: 1, pst: 2, subtotal: 999, total: 999 },
      items: [item({ amount: 10, unit_price: 5, qty: 2 }), item({ name_raw: 'Egg', amount: 5.5, unit_price: 5.5, qty: 1, taxable: 1 })],
    });
    expect(res.status).toBe(200);
    const r = await res.json();
    expect(r.store).toBe('T&T');
    expect(r.purchased_at).toBe('2026-06-09');
    expect(r.subtotal).toBe(15.5);
    expect(r.gst).toBe(1);
    expect(r.pst).toBe(2);
    expect(r.total).toBe(18.5);
    expect(r.items.map((i) => i.name_raw)).toEqual(['Milk', 'Egg']);
    expect(r.items[1].taxable).toBe(1);
    expect((await get(id)).items).toHaveLength(2);
  });

  it('可以删减明细、增加明细(整体替换)；单价缺失时回推', async () => {
    const u = await makeUser();
    const id = await seed(u);
    await loginAs(u);
    const r = await (await put(id, body({}, [item({ name_raw: 'A', amount: 9, qty: 3, unit_price: null }), item({ name_raw: 'B', amount: 1, qty: 1, unit_price: 1 })]))).json();
    expect(r.items.map((i) => i.name_raw)).toEqual(['A', 'B']);
    expect(r.items[0].unit_price).toBe(3);
    const r2 = await (await put(id, body({}, [item({ name_raw: 'Only', amount: 4, qty: 1, unit_price: 4 })]))).json();
    expect(r2.items.map((i) => i.name_raw)).toEqual(['Only']);
    expect(r2.subtotal).toBe(4);
  });

  it('不在白名单里的分类被归为"其他"', async () => {
    const u = await makeUser();
    const id = await seed(u);
    await loginAs(u);
    const r = await (await put(id, body({}, [item({ category: '不存在的分类' })]))).json();
    expect(r.items[0].category).toBe('其他');
  });

  it('不动 image_file、raw_json、currency、家庭归属；明细沿用小票当前的家庭归属', async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const familyId = await makeFamily(owner, other);
    const id = await seed(owner, { familyId });
    await loginAs(owner);
    expect((await put(id, body({ store: 'Changed' }, [item(), item({ name_raw: 'New' })]))).status).toBe(200);
    const [[r]] = await dbApi.pool.execute('SELECT * FROM receipts WHERE id = :id', { id });
    expect(r.image_file).toBe('keep.jpg');
    expect(r.raw_json).toBe('{"orig":1}');
    expect(r.currency).toBe('USD');
    expect(r.family_id).toBe(familyId);
    const [items] = await dbApi.pool.execute('SELECT family_id, family_name, account_type FROM items WHERE receipt_id = :id', { id });
    expect(items).toHaveLength(2);
    for (const i of items) {
      expect(i.family_id).toBe(familyId);
      expect(i.account_type).toBe('family');
    }
  });

  it('统计随编辑变化(分类汇总用的是新明细)', async () => {
    const u = await makeUser();
    const id = await seed(u);
    await loginAs(u);
    await put(id, body({}, [item({ category: '肉类', amount: 42, unit_price: 42, qty: 1 })]));
    const rows = await (await categoryRoute.GET(req('/api/stats/category'))).json();
    expect(rows.find((x) => x.label === '肉类').amount).toBe(42);
    expect(rows.find((x) => x.label === '乳制品蛋类')).toBeUndefined();
  });
});

describe('PUT /api/receipts/[id]: 权限(只有所有者)', () => {
  it('未登录 401', async () => {
    const u = await makeUser();
    const id = await seed(u);
    logout();
    expect((await put(id, body())).status).toBe(401);
  });

  it('同家庭的其他成员能看到但不能改: 404，数据不变', async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const familyId = await makeFamily(owner, member);
    const id = await seed(owner, { familyId });
    await loginAs(member);
    expect((await receiptRoute.GET(req('/x'), ctx({ id: String(id) }))).status).toBe(200); // 能看
    expect((await put(id, body({ store: 'HACK' }))).status).toBe(404);                      // 不能改
    const [[r]] = await dbApi.pool.execute('SELECT store FROM receipts WHERE id = :id', { id });
    expect(r.store).toBe('Costco');
    const [items] = await dbApi.pool.execute('SELECT id FROM items WHERE receipt_id = :id', { id });
    expect(items).toHaveLength(1);
  });

  it('家庭创建者也不能改成员的小票', async () => {
    const creator = await makeUser();
    const member = await makeUser();
    const familyId = await makeFamily(creator, member);
    const id = await seed(member, { familyId });
    await loginAs(creator);
    expect((await put(id, body())).status).toBe(404);
  });

  it('管理员也不能改别人的小票(与删除一致: 仅本人)', async () => {
    const owner = await makeUser();
    const admin = await makeUser({ admin: true });
    const id = await seed(owner);
    await loginAs(admin);
    expect((await put(id, body({ store: 'HACK' }))).status).toBe(404);
  });

  it('无关用户 404；不存在的 id 404；非数字 id 400', async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const id = await seed(owner);
    await loginAs(stranger);
    expect((await put(id, body())).status).toBe(404);
    expect((await put(99999999, body())).status).toBe(404);
    expect((await put('1abc', body())).status).toBe(400);
  });

  it('退出家庭后(小票随人走)仍然可以改自己的', async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const familyId = await makeFamily(owner, member);
    const id = await seed(member, { familyId });
    await dbApi.leaveFamily(member.id);
    await loginAs(member);
    const res = await put(id, body({ store: 'After' }));
    expect(res.status).toBe(200);
    const [items] = await dbApi.pool.execute('SELECT family_id FROM items WHERE receipt_id = :id', { id });
    expect(items[0].family_id).toBeNull();
  });
});

describe('PUT /api/receipts/[id]: 校验(不合法一律 400，数据不变)', () => {
  async function expect400(b) {
    const u = await makeUser();
    const id = await seed(u);
    await loginAs(u);
    const res = await put(id, b);
    expect(res.status).toBe(400);
    const [[r]] = await dbApi.pool.execute('SELECT store, purchased_at FROM receipts WHERE id = :id', { id });
    expect(r.store).toBe('Costco');
    const [items] = await dbApi.pool.execute('SELECT id FROM items WHERE receipt_id = :id', { id });
    expect(items).toHaveLength(1);
  }

  it('商家为空/只有空格', async () => {
    await expect400(body({ store: '   ' }));
    await expect400(body({ store: undefined }));
  });
  it('日期格式不对或不是真实日期', async () => {
    await expect400(body({ purchased_at: '2026/06/01' }));
    await expect400(body({ purchased_at: '2026-02-30' }));
    await expect400(body({ purchased_at: undefined }));
  });
  it('GST/PST 不是数字', async () => {
    await expect400(body({ gst: '1' }));
    await expect400(body({ pst: null }));
  });
  it('没有明细、明细过多、明细不是对象', async () => {
    await expect400(body({}, []));
    await expect400(body({}, Array.from({ length: 301 }, () => item())));
    await expect400(body({}, ['x']));
    await expect400({ receipt: body().receipt });
    await expect400({ items: [item()] });
  });
  it('明细字段不合法: 品名为空、金额/数量/单价不是数字、超出范围', async () => {
    await expect400(body({}, [item({ name_raw: '' })]));
    await expect400(body({}, [item({ amount: 'abc' })]));
    await expect400(body({}, [item({ qty: null })]));
    await expect400(body({}, [item({ unit_price: 'x' })]));
    await expect400(body({}, [item({ amount: 1e12 })]));
    await expect400(body({}, [item({ name_raw: 'x'.repeat(256) })]));
  });
  it('金额合计超出数据库范围', async () => {
    // 每行都合法(金额 < 上限、单价正常)，但合计 1.8e8 超过 DECIMAL(10,2)
    await expect400(body({}, [item({ amount: 9e7, unit_price: 1, qty: 1 }), item({ amount: 9e7, unit_price: 1, qty: 1 })]));
  });
  it('请求体过大 413；不是 JSON 对象 400', async () => {
    const u = await makeUser();
    const id = await seed(u);
    await loginAs(u);
    const huge = body({}, [item({ name_raw: 'x'.repeat(250) })]);
    huge.pad = 'y'.repeat(300 * 1024);
    expect((await put(id, huge)).status).toBe(413);
    expect((await put(id, '[1]')).status).toBe(400);
  });
  it('允许负数金额(折扣行)', async () => {
    const u = await makeUser();
    const id = await seed(u);
    await loginAs(u);
    const r = await (await put(id, body({ gst: 0, pst: 0 }, [item({ amount: 10, unit_price: 10, qty: 1 }), item({ name_raw: 'Discount', amount: -3, unit_price: -3, qty: 1 })]))).json();
    expect(r.subtotal).toBe(7);
    expect(r.total).toBe(7);
  });
});

describe('PUT /api/receipts/[id]: 验证后补充的规则', () => {
  async function owned() {
    const u = await makeUser();
    const id = await seed(u);
    await loginAs(u);
    return { u, id };
  }

  it('是否应税必须是布尔或 0/1', async () => {
    const { id } = await owned();
    expect((await put(id, body({}, [item({ taxable: 'yes' })]))).status).toBe(400);
    expect((await put(id, body({}, [item({ taxable: 2 })]))).status).toBe(400);
    expect((await put(id, body({}, [item({ taxable: true })]))).status).toBe(200);
  });

  it('数量太小(0 < |qty| < 0.001)返回 400；数量 0 允许', async () => {
    const { id } = await owned();
    expect((await put(id, body({}, [item({ qty: 0.0004, unit_price: null, amount: 5 })]))).status).toBe(400);
    expect((await put(id, body({}, [item({ qty: 0, unit_price: null, amount: 5 })]))).status).toBe(200);
  });

  it('单价缺失时回推出的单价超出范围 → 400 而不是 500', async () => {
    const { id } = await owned();
    const res = await put(id, body({}, [item({ qty: 0.001, unit_price: null, amount: 1000 })]));
    expect(res.status).toBe(400);
    expect((await put(id, body({}, [item({ qty: 0.001, unit_price: null, amount: 50 })]))).status).toBe(200);
  });

  it('金额先取整到分再求和: 小计/总额与落库后的各行之和一致', async () => {
    const { id } = await owned();
    const r = await (await put(id, body({ gst: 0.015, pst: 0.015 }, [0.005, 0.005, 0.005].map((a, i) => item({ name_raw: 'p' + i, amount: a, unit_price: a, qty: 1 }))))).json();
    const sum = r.items.reduce((x, i) => x + i.amount, 0);
    expect(r.subtotal).toBeCloseTo(sum, 2);
    expect(r.total).toBeCloseTo(r.subtotal + r.gst + r.pst, 2);
  });

  it('日期年份太早(0000)、商家含 NUL 字符 → 400', async () => {
    const { id } = await owned();
    expect((await put(id, body({ purchased_at: '0000-01-01' }))).status).toBe(400);
    expect((await put(id, body({ store: 'a\u0000b' }))).status).toBe(400);
  });

  it('updateReceipt 本身也校验所有者(不依赖路由): 别人的 userId 返回 false，数据不变', async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const id = await seed(owner);
    const ok = await dbApi.updateReceipt(id, other.id, { store: 'HACK', purchased_at: '2026-01-01', subtotal: 1, gst: 0, pst: 0, total: 1 }, [item()]);
    expect(ok).toBe(false);
    const [[r]] = await dbApi.pool.execute('SELECT store FROM receipts WHERE id = :id', { id });
    expect(r.store).toBe('Costco');
  });

  it('与改名/解散并发: 编辑不死锁、不留下过期的家庭名', async () => {
    for (let round = 0; round < 8; round++) {
      const owner = await makeUser();
      const member = await makeUser();
      const familyId = await makeFamily(owner, member);
      const id = await seed(member, { familyId });
      const [[{ name: famName }]] = await dbApi.pool.execute('SELECT name FROM families WHERE id = :id', { id: familyId });
      const results = await Promise.allSettled([
        dbApi.updateReceipt(id, member.id, { store: 'E', purchased_at: '2026-01-01', subtotal: 1, gst: 0, pst: 0, total: 1 }, [item(), item({ name_raw: 'Z' })]),
        round % 2 ? dbApi.renameFamily(familyId, owner.id, uniq('renamed')) : dbApi.dissolveFamily(familyId, owner.id, famName),
      ]);
      for (const r of results) expect(r.status).toBe('fulfilled');
      const [[fam]] = await dbApi.pool.execute('SELECT family_id, family_name FROM receipts WHERE id = :id', { id });
      const [its] = await dbApi.pool.execute('SELECT family_id, family_name FROM items WHERE receipt_id = :id', { id });
      expect(its).toHaveLength(2);
      for (const i of its) {
        expect(i.family_id).toBe(fam.family_id);
        expect(i.family_name).toBe(fam.family_name);
      }
    }
  });
});

describe('GET /api/receipts/duplicates: 重复提示', () => {
  const dups = async (store, date, total) =>
    (await dupRoute.GET(req(`/api/receipts/duplicates?store=${encodeURIComponent(store)}&date=${date}&total=${total}`))).json();

  it('自己的: 同商家 + 同日期 + 同总额 → 命中；任一不同 → 不命中', async () => {
    const u = await makeUser();
    const store = uniq('S');
    await seed(u, { store, date: '2026-07-01', total: 12.34 });
    await loginAs(u);
    expect(await dups(store, '2026-07-01', 12.34)).toHaveLength(1);
    expect(await dups(store, '2026-07-02', 12.34)).toHaveLength(0);
    expect(await dups(store, '2026-07-01', 12.35)).toHaveLength(0);
    expect(await dups(store + 'x', '2026-07-01', 12.34)).toHaveLength(0);
  });

  it('商家比较忽略首尾空格和大小写', async () => {
    const u = await makeUser();
    const store = uniq('Shop');
    await seed(u, { store, date: '2026-07-03', total: 5 });
    await loginAs(u);
    expect(await dups('  ' + store.toLowerCase() + ' ', '2026-07-03', 5)).toHaveLength(1);
  });

  it('家庭内: 能命中其他成员在家庭里保存的小票(并带出所有者)', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const familyId = await makeFamily(a, b);
    const store = uniq('Fam');
    await seed(a, { familyId, store, date: '2026-07-04', total: 20 });
    await loginAs(b);
    const r = await dups(store, '2026-07-04', 20);
    expect(r).toHaveLength(1);
    expect(r[0].owner_username).toBe(a.username);
  });

  it('不在家庭: 命中不了别人的小票', async () => {
    const a = await makeUser();
    const stranger = await makeUser();
    const store = uniq('Priv');
    await seed(a, { store, date: '2026-07-05', total: 7 });
    await loginAs(stranger);
    expect(await dups(store, '2026-07-05', 7)).toHaveLength(0);
  });

  it('同家庭成员加入前记的个人小票(没有家庭归属)不会被别人命中', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const store = uniq('Old');
    await seed(a, { store, date: '2026-07-06', total: 9 }); // a 的旧个人小票
    await makeFamily(a, b);
    await loginAs(b);
    expect(await dups(store, '2026-07-06', 9)).toHaveLength(0);
    await loginAs(a);
    expect(await dups(store, '2026-07-06', 9)).toHaveLength(1); // 本人仍命中
  });

  it('只提示不拦截: 重复的小票仍可以保存', async () => {
    const u = await makeUser();
    const store = uniq('Dup');
    await seed(u, { store, date: '2026-07-07', total: 3 });
    await loginAs(u);
    const res = await receiptsRoute.POST(req('/api/receipts', {
      method: 'POST',
      body: { receipt: { store, purchased_at: '2026-07-07', currency: 'CAD', subtotal: 3, gst: 0, pst: 0, total: 3 }, items: [item({ amount: 3, unit_price: 3, qty: 1 })] },
    }));
    expect(res.status).toBe(200);
    expect(await dups(store, '2026-07-07', 3)).toHaveLength(2);
  });

  it('参数缺失/不合法 400；未登录 401', async () => {
    const u = await makeUser();
    await loginAs(u);
    for (const q of ['', '?store=a&date=2026-07-07', '?store=a&date=bad&total=1', '?store=&date=2026-07-07&total=1', '?store=a&date=2026-07-07&total=abc', '?store=a&date=2026-07-07&total=1e12']) {
      expect((await dupRoute.GET(req('/api/receipts/duplicates' + q))).status).toBe(400);
    }
    logout();
    expect((await dupRoute.GET(req('/api/receipts/duplicates?store=a&date=2026-07-07&total=1'))).status).toBe(401);
  });

  it('商家比较会去掉首尾空格: 库里带空格的商家也能命中', async () => {
    const u = await makeUser();
    const store = uniq('Pad');
    await seed(u, { store: '  ' + store + '  ', date: '2026-07-08', total: 11 });
    await loginAs(u);
    expect(await dups(store, '2026-07-08', 11)).toHaveLength(1);
  });

  it('最多返回 5 条，并带出所有者用户名', async () => {
    const u = await makeUser();
    const store = uniq('Many');
    for (let i = 0; i < 6; i++) await seed(u, { store, date: '2026-07-09', total: 13 });
    await loginAs(u);
    const r = await dups(store, '2026-07-09', 13);
    expect(r).toHaveLength(5);
    expect(r[0].owner_username).toBe(u.username);
  });

  it('日期格式对但不是真实日期(2026-99-99) → 400 而不是 500', async () => {
    const u = await makeUser();
    await loginAs(u);
    expect((await dupRoute.GET(req('/api/receipts/duplicates?store=a&date=2026-99-99&total=1'))).status).toBe(400);
  });
});
