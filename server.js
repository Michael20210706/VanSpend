'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');

// --- 极简 .env 加载 (避免额外依赖) ---
(function loadEnv() {
  const envPath = path.join(__dirname, '.env');
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

const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: '25mb' })); // base64 图片可能较大
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error(e);
  res.status(500).json({ error: e.message });
});

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
    { ...receipt, image_file, raw_json: JSON.stringify(req.body.raw || { receipt, items }) },
    items
  );
  res.json({ id });
}));

app.get('/api/receipts', wrap(async (req, res) => res.json(await dbApi.listReceipts())));
app.get('/api/receipts/:id', wrap(async (req, res) => {
  const r = await dbApi.getReceipt(+req.params.id);
  if (!r) return res.status(404).json({ error: '未找到' });
  res.json(r);
}));
app.delete('/api/receipts/:id', wrap(async (req, res) => {
  res.json({ deleted: await dbApi.deleteReceipt(+req.params.id) });
}));

// 统计
app.get('/api/stats/overview',    wrap(async (req, res) => res.json(await dbApi.overview(req.query.from, req.query.to))));
app.get('/api/stats/category',    wrap(async (req, res) => res.json(await dbApi.statsByCategory(req.query.from, req.query.to))));
app.get('/api/stats/subcategory', wrap(async (req, res) => res.json(await dbApi.statsBySubcategory(req.query.category, req.query.from, req.query.to))));
app.get('/api/stats/monthly',     wrap(async (req, res) => res.json(await dbApi.statsMonthly(req.query.from, req.query.to))));
app.get('/api/stats/trend',       wrap(async (req, res) => {
  if (!req.query.name) return res.status(400).json({ error: '缺少 name' });
  res.json(await dbApi.priceTrend(req.query.name, req.query.store));
}));
app.get('/api/items/names', wrap(async (req, res) => res.json(await dbApi.distinctItemNames())));

const port = process.env.PORT || config.port || 5173;
app.listen(port, () => {
  console.log(`\n  VanSpend 已启动 →  http://localhost:${port}`);
  console.log(`  模型: ${config.model}   API Key: ${process.env.OPENROUTER_API_KEY ? '已配置' : '未配置(请填 .env)'}\n`);
});
