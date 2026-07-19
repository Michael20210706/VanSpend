'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const bcrypt = require('bcryptjs');

const ROOT_DIR = path.join(__dirname, '..');

// --- 极简 .env 加载 (避免额外依赖) ---
(function loadEnv() {
  const envPath = path.join(ROOT_DIR, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
})();

const dbApi = require('./db');
const { scanReceipt, config } = require('./openrouter');

const UPLOAD_DIR = path.join(ROOT_DIR, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: '25mb' })); // base64 图片可能较大
app.use(express.static(path.join(ROOT_DIR, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

if (!process.env.SESSION_SECRET) {
  console.warn('[server] 未设置 SESSION_SECRET，本次启动将使用随机密钥(重启后所有人需重新登录)，建议在 .env 中固定该值');
}
// 会话存到同一个 MySQL 库(复用 db.js 的连接池)，不引入 Redis 等额外组件
const sessionStore = new MySQLStore({}, dbApi.pool);
app.use(session({
  key: 'vanspend.sid',
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false, // 应用本身仅监听 localhost，无 TLS 终结在这一层
    maxAge: 30 * 24 * 60 * 60 * 1000
  }
}));

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error(e);
  res.status(500).json({ error: e.message });
});

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: '未登录' });
  next();
}

// 把 dataUrl 存成图片文件，返回文件名
function saveImage(dataUrl) {
  const m = /^data:(image\/\w+);base64,(.+)$/s.exec(dataUrl || '');
  if (!m) return null;
  const ext = m[1].split('/')[1].replace('jpeg', 'jpg');
  const file = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, file), Buffer.from(m[2], 'base64'));
  return file;
}

app.get('/api/config', (req, res) => {
  res.json({
    model: config.model,
    categories: config.categories,
    currency: config.currency,
    region: config.region,
    hasKey: !!process.env.OPENROUTER_API_KEY
  });
});

// ---- 鉴权(开放注册，每个账号只能看到自己上传的小票) ----
app.post('/api/auth/register', wrap(async (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
  if (await dbApi.findUserByUsername(username)) return res.status(400).json({ error: '用户名已存在' });
  const isFirstUser = (await dbApi.countUsers()) === 0;
  const passwordHash = await bcrypt.hash(password, 10);
  const id = await dbApi.createUser(username, passwordHash);
  if (isFirstUser) await dbApi.backfillOwnerlessReceipts(id); // 迁移: 功能上线前的旧数据归给首个账号
  req.session.userId = id;
  req.session.username = username;
  res.json({ id, username });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  const user = username ? await dbApi.findUserByUsername(username) : null;
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ id: user.id, username: user.username });
}));

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: '未登录' });
  res.json({ id: req.session.userId, username: req.session.username });
});

app.use(['/api/scan', '/api/receipts', '/api/stats', '/api/items'], requireAuth);

// 仅识别，不入库，返回给前端确认/编辑
app.post('/api/scan', wrap(async (req, res) => {
  const { image } = req.body;
  if (!image) return res.status(400).json({ error: '缺少图片' });
  const result = await scanReceipt(image);
  res.json(result);
}));

// 确认后保存
app.post('/api/receipts', wrap(async (req, res) => {
  const { receipt, items, image } = req.body;
  if (!receipt || !Array.isArray(items)) return res.status(400).json({ error: '数据格式错误' });
  const image_file = image ? saveImage(image) : null;
  const id = await dbApi.saveReceipt(
    { ...receipt, user_id: req.session.userId, image_file, raw_json: JSON.stringify(req.body.raw || { receipt, items }) },
    items
  );
  res.json({ id });
}));

app.get('/api/receipts', wrap(async (req, res) => res.json(await dbApi.listReceipts({
  from: req.query.from, to: req.query.to, search: req.query.search, userId: req.session.userId
}))));
app.get('/api/receipts/:id', wrap(async (req, res) => {
  const r = await dbApi.getReceipt(+req.params.id, req.session.userId);
  if (!r) return res.status(404).json({ error: '未找到' });
  res.json(r);
}));
app.delete('/api/receipts/:id', wrap(async (req, res) => {
  res.json({ deleted: await dbApi.deleteReceipt(+req.params.id, req.session.userId) });
}));

// 统计
app.get('/api/stats/overview',    wrap(async (req, res) => res.json(await dbApi.overview(req.query.from, req.query.to, req.session.userId))));
app.get('/api/stats/category',    wrap(async (req, res) => res.json(await dbApi.statsByCategory(req.query.from, req.query.to, req.session.userId))));
app.get('/api/stats/subcategory', wrap(async (req, res) => res.json(await dbApi.statsBySubcategory(req.query.category, req.query.from, req.query.to, req.session.userId))));
app.get('/api/stats/monthly',     wrap(async (req, res) => res.json(await dbApi.statsMonthly(req.query.from, req.query.to, req.session.userId))));
app.get('/api/stats/trend',       wrap(async (req, res) => {
  if (!req.query.name) return res.status(400).json({ error: '缺少 name' });
  res.json(await dbApi.priceTrend(req.query.name, req.query.store, req.session.userId));
}));
app.get('/api/items/names', wrap(async (req, res) => res.json(await dbApi.distinctItemNames(req.session.userId))));

const port = process.env.PORT || config.port || 5173;
app.listen(port, () => {
  console.log(`\n  VanSpend 已启动 →  http://localhost:${port}`);
  console.log(`  模型: ${config.model}   API Key: ${process.env.OPENROUTER_API_KEY ? '已配置' : '未配置(请填 .env)'}\n`);
});
