# VanSpend · 家庭小票扫描与精细化记账

单机单用户版。上传超市/餐厅小票图片 → 用 OpenRouter 多模态模型(Gemini 2.5 Flash)识别成 **逐行明细(line-items)** → 存入外部 MySQL 数据库 → 在网页里做多维度统计与价格趋势分析。专门处理 Costco、大统华(T&T)等单张长小票，并按 BC 省规则拆分 **GST(5%) / PST(7%)**。

结构化数据存在你指定的 MySQL 库里,小票原图留在本机 `uploads/` 目录。

## 解决的痛点

- 传统记账只能记"在 Costco 花了 $180",VanSpend 记的是这 $180 里牛肉多少、蔬菜多少、日用品多少。
- 自动分离 GST / PST,清楚每月缴了多少税。
- 跨时间比价:同一样东西(如 Costco 牛肉)几个月来的单价走势、占总花费的比例。

## 环境要求

- Node.js ≥ 18。检查版本:`node -v`。
- 一个可连接的 MySQL 数据库(8.0/5.7 均可),以及一个已提前建好、账号有读写权限的库。
- 一个 OpenRouter API Key:https://openrouter.ai/keys

## 安装与启动

```bash
cd VanSpend
npm install                 # express + mysql2
cp .env.example .env        # 编辑 .env: 填入 OPENROUTER_API_KEY 及 MYSQL_HOST/PORT/USER/PASSWORD/DATABASE

# 首次使用需先建库建表: 若 MYSQL_USER 有 DDL 权限, 应用启动时会自动建表(CREATE TABLE IF NOT EXISTS);
# 若账号权限受限，请先手动执行:
mysql -h $MYSQL_HOST -u $MYSQL_USER -p < schema.sql

npm start                   # 打开 http://localhost:5173
```

## 使用流程

1. **上传识别**:拖入小票图片 → 点「AI 识别」→ 模型返回逐行明细。
2. **核对并保存**:识别结果以可编辑表格呈现(分类用下拉、税额可改),确认无误点「保存到账本」。AI 识别有误时在这一步手动修正即可。
3. **数据分析**:
   - 概览卡片:实付总额、税额、GST、PST、小票数、条目数。
   - 各分类花费占比(环形图)。
   - 细分花费:选「肉类」即可看到牛/猪/鸡各花了多少;同理海鲜、蔬菜等。
   - 月度花费与税额(堆叠柱状图,税前/GST/PST)。
   - 价格趋势:输入品名(如「牛肉」「三文鱼」)可选商家,看单价随时间的折线。
   - 所有图表支持时间区间筛选。
4. **小票记录**:查看每张小票的完整明细与原图,可删除。

## 配置 `config.json`

| 字段 | 说明 |
|------|------|
| `model` | OpenRouter 模型 slug。换模型只改这里,如 `anthropic/claude-3.7-sonnet`、`openai/gpt-4o` |
| `port` | 网页端口,默认 5173 |
| `taxRates` | GST/PST 税率(供识别提示参考) |
| `categories` | 顶层分类清单。改这里会同步影响识别提示与前端下拉 |

## 数据结构

- `receipts`:每张小票一行(商家、日期、税前、GST、PST、实付、原图、模型原始返回)。
- `items`:每个商品一行,关联小票(原文名、规范名、分类、细分、数量、单位、单价、金额、是否计税)。

直接用任意 MySQL 客户端连接 `.env` 里配置的库也能自由查询,表结构见 `schema.sql`。

## 自检

```bash
npm run selfcheck   # 离线验证解析与统计逻辑(不消耗 API)
```

## Scope Boundaries(边界与取舍)

**已知取舍与风险**
- AI 识别非 100% 准确:模糊/褶皱小票、生僻品名、手写价签可能出错。**保存前的核对步骤是必须的人工关口**,不要盲存。
- GST/PST 拆分依赖小票上印出的税行/税码。若小票只印了一个合计税,程序按 5%/7% 比例估算;拆不出的填 0,需人工补。
- 品名规范化(`name_norm`)由模型给出,跨时间比价靠模糊匹配。同一商品若两次识别出的规范名差异较大,趋势图可能漏算——必要时在核对步骤统一品名。
- 每张小票一次模型调用,会产生 OpenRouter 费用(Gemini 2.5 Flash 很便宜,但非零)。

**严格约束**
- 需要一个可达的外部 MySQL 服务;连接信息(`MYSQL_HOST/PORT/USER/PASSWORD/DATABASE`)放在 `.env`,不要提交到版本库。
- 单用户、无鉴权,应用本身仍只监听 localhost,不要直接暴露到公网;MySQL 也不应对外网开放。
- 小票原图仍存本地 `uploads/` 目录,不进 MySQL,只有文件名存在 `receipts.image_file` 里。

**本期明确不包含**
- 无用户系统、无多人协作、无 `uploads/` 目录的云备份/同步。
- 无预算上限/提醒、无收入侧记账、无导出报表(PDF/Excel)。
- 无自动批量导入(逐张上传);无银行/信用卡对账单对接。
- 无离线 OCR 兜底:断网或无 API Key 时无法识别(但已有数据的查询分析不受影响)。
- 无连接池调优、重试/退避、迁移框架 — 仅 `schema.sql` + 应用自身的 `CREATE TABLE IF NOT EXISTS`。
