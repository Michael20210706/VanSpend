'use strict';

const fs = require('fs');
const path = require('path');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

// 让模型只做识别+归类，税额拆分我们这里给出 BC 规则说明，让模型按小票上的税码/税行还原
function buildPrompt() {
  const cats = config.categories.join('、');
  return `你是一个加拿大 BC 省(温哥华)家庭记账的小票识别助手。请仔细阅读这张超市/餐厅小票图片(常见商家: Costco、大统华 T&T、Superstore、Walmart、餐厅等)，把它转成结构化 JSON。

要求:
1. 逐行提取每个商品(line item)。小票品名常是英文缩写或中文，请同时给出原文(name_raw)与规范化中文品名(name_norm，便于跨时间比价，如 "牛肉西冷"、"鸡胸肉"、"三文鱼")。
2. 分类(category)只能从这些里选一个: ${cats}。
3. 细分(subcategory): 给更细的类型。肉类必须细分为 牛肉/猪肉/鸡肉/羊肉/其他肉类; 海鲜细分为 三文鱼/虾/蟹/鱼类/贝类/其他海鲜; 其余大类可给合理细分或留空。
4. 每行给出: 数量 qty、单位 unit(个/kg/lb/包/份)、单价 unit_price、该行金额 amount(税前)。读不到就用 null。
5. taxable: 该商品是否计税。BC 省多数食品(basic groceries)免 GST/PST; 预制食品、汽水、日用品、餐厅餐食通常计税。小票上常用 G/P/H 或星号等标记，请据此判断 true/false。
6. 税额: 按小票上实际印出的税行还原 gst 与 pst(BC: GST=5%, PST=7%)。若小票只给了一个合计税(如 HST/Tax)，尽量按 5%/7% 比例拆分; 拆不出就把能确定的填上、其余填 0。
7. store(商家名)、purchased_at(购买日期 YYYY-MM-DD，读不到用空字符串)、subtotal(税前合计)、total(实付总额)。
8. 金额都用数字(不带货币符号)，货币 currency 默认 "CAD"。

只输出一个 JSON 对象，不要任何解释或 markdown 代码块。结构:
{
  "store": "Costco",
  "purchased_at": "2026-06-10",
  "currency": "CAD",
  "subtotal": 0,
  "gst": 0,
  "pst": 0,
  "total": 0,
  "items": [
    {"name_raw":"","name_norm":"","category":"","subcategory":"","qty":1,"unit":"","unit_price":0,"amount":0,"taxable":false}
  ]
}`;
}

function extractJson(text) {
  if (!text) throw new Error('模型返回为空');
  let t = text.trim();
  // 去掉可能的 ```json ``` 包裹
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  // 截取第一个 { 到最后一个 }
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('模型返回中未找到 JSON: ' + text.slice(0, 200));
  return JSON.parse(t.slice(start, end + 1));
}

// dataUrl: "data:image/jpeg;base64,...."
async function scanReceipt(dataUrl) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('未设置 OPENROUTER_API_KEY（请在 .env 中填写）');

  const body = {
    model: config.model,
    temperature: 0,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: buildPrompt() },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      }
    ]
  };

  const resp = await fetch(`${config.openrouterBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost',
      'X-Title': 'VanSpend'
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`OpenRouter 请求失败 ${resp.status}: ${errText.slice(0, 300)}`);
  }

  const json = await resp.json();
  const content = json.choices?.[0]?.message?.content;
  const parsed = extractJson(typeof content === 'string' ? content : JSON.stringify(content));
  return normalize(parsed);
}

// 规范化 + 校验，保证写库字段齐全
function normalize(p) {
  const num = (v) => {
    const n = typeof v === 'string' ? parseFloat(v.replace(/[^0-9.\-]/g, '')) : v;
    return Number.isFinite(n) ? n : 0;
  };
  const today = new Date().toISOString().slice(0, 10);
  const validCats = new Set(config.categories);

  const items = Array.isArray(p.items) ? p.items.map((it) => {
    let cat = (it.category || '').trim();
    if (!validCats.has(cat)) cat = '其他';
    return {
      name_raw: (it.name_raw || it.name || '未知商品').toString().trim(),
      name_norm: (it.name_norm || it.name_raw || '').toString().trim() || null,
      category: cat,
      subcategory: (it.subcategory || '').toString().trim() || null,
      qty: it.qty == null ? 1 : num(it.qty),
      unit: (it.unit || '').toString().trim() || null,
      unit_price: it.unit_price == null ? null : num(it.unit_price),
      amount: num(it.amount),
      taxable: it.taxable ? 1 : 0
    };
  }) : [];

  // 若单价缺失但有数量与金额，回推单价
  for (const it of items) {
    if ((it.unit_price == null || it.unit_price === 0) && it.qty) {
      it.unit_price = +(it.amount / it.qty).toFixed(4);
    }
  }

  const receipt = {
    store: (p.store || '未知').toString().trim() || '未知',
    purchased_at: /^\d{4}-\d{2}-\d{2}$/.test(p.purchased_at) ? p.purchased_at : today,
    currency: (p.currency || config.currency).toString().trim() || config.currency,
    subtotal: num(p.subtotal),
    gst: num(p.gst),
    pst: num(p.pst),
    total: num(p.total)
  };

  // 兜底: subtotal 缺失则用明细求和
  if (!receipt.subtotal && items.length) {
    receipt.subtotal = +items.reduce((s, i) => s + i.amount, 0).toFixed(2);
  }
  if (!receipt.total) {
    receipt.total = +(receipt.subtotal + receipt.gst + receipt.pst).toFixed(2);
  }

  return { receipt, items, raw: p };
}

module.exports = { scanReceipt, normalize, config };
