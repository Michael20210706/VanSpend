# VanSpend · 家庭小票扫描与精细化记账

单机多用户版：家庭成员各自注册账号登录，各自上传的小票/明细只归自己可见。上传超市/餐厅小票图片 → 用 OpenRouter 多模态模型(Gemini 2.5 Flash)识别成 **逐行明细(line-items)** → 存入外部 MySQL 数据库 → 在网页里做多维度统计与价格趋势分析。专门处理 Costco、大统华(T&T)等单张长小票，并按 BC 省规则拆分 **GST(5%) / PST(7%)**。

结构化数据存在你指定的 MySQL 库里,小票原图留在本机 `uploads/` 目录。

## 解决的痛点

- 传统记账只能记"在 Costco 花了 $180",VanSpend 记的是这 $180 里牛肉多少、蔬菜多少、日用品多少。
- 自动分离 GST / PST,清楚每月缴了多少税。
- 跨时间比价:同一样东西(如 Costco 牛肉)几个月来的单价走势、占总花费的比例。

## 环境要求

- Node.js ≥ 22。检查版本:`node -v`。
- 一个可连接的 MySQL 数据库(8.0/5.7 均可),以及一个已提前建好、账号有读写权限的库。
- 一个 OpenRouter API Key:https://openrouter.ai/keys

## 安装与启动

```bash
cd VanSpend
npm install                 # next + react + react-dom + react-chartjs-2 + chart.js + iron-session + mysql2 + bcryptjs
cp .env.example .env        # 编辑 .env: 填入 OPENROUTER_API_KEY、MYSQL_HOST/PORT/USER/PASSWORD/DATABASE、SESSION_SECRET、PORT
                             # 可选: 填 ADMIN_USERNAME/ADMIN_PASSWORD，启动时会自动创建一个管理员账号

# 首次使用需先建库建表: 若 MYSQL_USER 有 DDL 权限, 应用启动时会自动建表(CREATE TABLE IF NOT EXISTS);
# 若账号权限受限，请先手动执行:
mysql -h $MYSQL_HOST -u $MYSQL_USER -p < sql/schema.sql

npm run build && npm start  # 打开 http://localhost:3000(端口取 .env 里的 PORT，默认 3000)，首次打开会先要求注册/登录
# 开发时可以用 npm run dev 代替 build+start(带热更新)
```

首次打开会看到登录/注册卡片。注册有两种方式:有邀请码的(正常额度的账号和管理员能在顶栏"邀请"里生成,单次有效、7 天过期,每人 7 天最多 20 个,不需要验证码,每天可识别 20 次)和没有邀请码的开放注册(需过验证码,每天只能识别 3 次,管理员可以在后台升级);第一个开放注册的账号会自动接管升级前(无归属)的旧小票数据。之后每个账号只能看到自己上传的小票和统计数据。

如果 `.env` 里配了 `ADMIN_USERNAME`/`ADMIN_PASSWORD`,启动时会自动创建这个管理员账号(只创建一次,已存在的同名账号不会被覆盖密码/角色)。用这个账号登录后,右上角会出现「管理后台」入口(`/admin`),可以看到所有用户、所有小票,并按用户/时间/分类等维度统计。

### 用 Docker 运行

```bash
cp .env.example .env        # 同上，先填好 .env
docker compose up -d        # 启动 app + 一个本地 MySQL(仅供试用/演示)
```

若已有外部 MySQL(生产场景推荐),编辑 `docker-compose.yml` 删掉 `mysql` 这个 service,
并把 `.env` 里的 `MYSQL_HOST`/`MYSQL_PORT` 指向你的外部实例即可，`app` service 会通过
`env_file: .env` 读取所有配置。也可以只用 `docker build -t vanspend .` 单独构建镜像。

## 项目结构

VanSpend 是一个 Next.js(App Router)全栈应用: 前端页面和 API 路由都在同一个项目里。

```
app/            页面 + API 路由: page.js/layout.js(前端), api/**/route.js(接口，含 api/admin/**), uploads/[...file]/route.js(小票原图), admin/page.js(管理后台页面)
components/     React 组件: Header / AuthGate / LoginClient / ScanTab / DashboardTab / ReceiptsTab / Toast
                components/landing/ 是未登录时的宣传落地页(Landing / sections / mocks / copy / landing.css)
                components/admin/ 下是管理后台的 StatsPanel / ReceiptsPanel / UsersPanel
lib/            前端小工具: api.js(fetch 封装) / toast.js / dateRange.js
src/            后端逻辑: db.cjs(MySQL 访问) / openrouter.cjs(AI 识别) / uploads.cjs / session.js(登录会话)
config/         config.json(模型、税率、分类；端口现在由 .env 的 PORT 控制)
sql/            schema.sql(MySQL 建表 DDL)
tests/          Vitest 测试(连独立的 vanspend_test 库，见下方「测试」)
uploads/        小票原图(运行时生成，不入库)
Dockerfile, docker-compose.yml, .dockerignore   容器构建/发布(多阶段构建，next build 产物)
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

## 管理后台(`/admin`)

只有管理员账号(`is_admin`)能访问,普通注册账号看不到、也进不去(未登录 401、登录了但不是管理员 403)。

- **统计**:概览 KPI、各分类占比、细分花费、月度趋势,均可选「全部用户」或指定某个用户;外加一个单用户视图里没有的维度——「各用户花费排行」。
- **票据管理**:查看/搜索/删除任意用户的小票(可按用户筛选),明细里能看到这张小票是谁上传的。
- **用户管理**:所有账号列表(注册时间、小票数、累计花费、是否管理员),可删除账号(级联删掉该账号名下所有小票和明细;不能删除当前登录的管理员自己)。

只能看/删,不支持在后台编辑小票或明细(和普通用户流程一致——保存后的小票本来就不能编辑,只能删)。

## 配置 `config.json`

| 字段 | 说明 |
|------|------|
| `model` | OpenRouter 模型 slug。换模型改这里,如 `anthropic/claude-3.7-sonnet`、`openai/gpt-4o`;也可以不改配置文件,在 `.env` 里设 `OPENROUTER_MODEL` 覆盖(优先级更高) |
| `taxRates` | GST/PST 税率(供识别提示参考) |
| `categories` | 顶层分类清单。改这里会同步影响识别提示与前端下拉 |

网页端口不再由 `config.json` 控制,改成 `.env` 里的 `PORT`(Next.js 原生读取,默认 3000)。

## 数据结构

- `users`:账号(用户名、密码哈希、是否管理员 `is_admin`)。
- `receipts`:每张小票一行(归属用户、商家、日期、税前、GST、PST、实付、原图、模型原始返回)。
- `items`:每个商品一行,关联小票(原文名、规范名、分类、细分、数量、单位、单价、金额、是否计税)。

直接用任意 MySQL 客户端连接 `.env` 里配置的库也能自由查询,表结构见 `sql/schema.sql`。

## 测试

```bash
npm test   # vitest run：解析/统计、会话实时校验、原图鉴权、登录防爆破、上传大小限制
```

测试连接独立的测试库(`.env.test` 里的 `MYSQL_DATABASE=vanspend_test`，必须以 `_test` 结尾，否则拒绝运行)，
每次运行前会删库重建；MySQL 账号密码沿用 `.env`，本机特有的覆盖写到 `.env.test.local`。测试不会调用 OpenRouter，不产生费用。

## Scope Boundaries(边界与取舍)

**已知取舍与风险**
- AI 识别非 100% 准确:模糊/褶皱小票、生僻品名、手写价签可能出错。**保存前的核对步骤是必须的人工关口**,不要盲存。
- GST/PST 拆分依赖小票上印出的税行/税码。若小票只印了一个合计税,程序按 5%/7% 比例估算;拆不出的填 0,需人工补。
- 品名规范化(`name_norm`)由模型给出,跨时间比价靠模糊匹配。同一商品若两次识别出的规范名差异较大,趋势图可能漏算——必要时在核对步骤统一品名。
- 每张小票一次模型调用,会产生 OpenRouter 费用(Gemini 2.5 Flash 很便宜,但非零)。
- 登录会话是无状态的签名/加密 cookie(iron-session),不在数据库里存会话记录;没有服务端强制踢下线某一个会话的能力(改密码不会让其他设备下线)。但权限和家庭归属在每个请求都会按数据库重新核对(每次多一次主键查询),撤销管理员、加入家庭、删除账号都在下一个请求立即生效。
- 登录防爆破:同一用户名或同一 IP 在 15 分钟内失败 10 次,就从凑满第 10 次起锁定 15 分钟(密码正确也拒绝)。任何人都可以故意把一个已知用户名(包括管理员)锁住 15 分钟;本地开发时所有请求可能共用一个 IP,失败 10 次会把整个本机锁住。修改密码接口里的"当前密码"校验不限流。
- 换成 Next.js 后需要 `next build` 构建步骤,镜像体积/构建耗时比旧版零构建的静态文件版本更大。
- 管理后台能看/删任意用户的小票、能删除任意用户账号(级联删光其数据),这是真实的、破坏性的跨用户权限,没有撤销,也没有操作日志。

**严格约束**
- 需要一个可达的外部 MySQL 服务;连接信息(`MYSQL_HOST/PORT/USER/PASSWORD/DATABASE`)放在 `.env`,不要提交到版本库。
- 公网访问只经 Cloudflare Tunnel:`docker-compose.yml` 里应用端口只绑定 `127.0.0.1`,用 `docker compose --profile tunnel up -d` 启动 `cloudflared`(token 写在 `.env` 的 `TUNNEL_TOKEN`)。公网部署必须在 `.env` 设 `COOKIE_SECURE=true`;本地 http://localhost 试用保持 `false`。应用端口和 MySQL 都不要对公网开放——登录防爆破按 `CF-Connecting-IP` 取客户端 IP,只有在应用无法被绕过 Tunnel 直连时这个头才可信。
- 注册无需管理员审批:要么用邀请码(正常额度的账号能生成;开放注册的账号不能发码,要先由管理员升级),要么开放注册(验证码,识别额度较低);普通账号之间平等,只能看到自己的数据,没有"家庭共享可见"模式。唯一的例外角色是 `is_admin`,只能通过启动时的 `ADMIN_USERNAME`/`ADMIN_PASSWORD` 初始化,注册接口本身永远不会赋予这个角色。
- 小票原图仍存本地 `uploads/` 目录,不进 MySQL,只有文件名存在 `receipts.image_file` 里。`/uploads/<文件>` 只给上传者本人、同家庭成员和管理员看,其余情况一律 404,并带 `Cache-Control: private, no-store`(防止 Cloudflare 边缘缓存)。单张图片上限 10 MB,浏览器上传前会把长边压缩到 2000 像素以内。

**本期明确不包含**
- 管理后台不支持编辑小票/明细(只能查看和删除)、无操作审计日志、无"以某用户身份登录"功能、无在应用内创建/提升管理员的界面。
- 无密码重置/邮箱验证。
- 除 `is_admin` 外无更细粒度的角色权限;家庭内是"只读共享"(编辑/删除小票仍只有本人),没有合并历史账本的功能:加入家庭之前记的小票只有本人可见。
- 无 `uploads/` 目录的云备份/同步。
- 无预算上限/提醒、无收入侧记账、无导出报表(PDF/Excel)。
- 无自动批量导入(逐张上传);无银行/信用卡对账单对接。
- 无离线 OCR 兜底:断网或无 API Key 时无法识别(但已有数据的查询分析不受影响)。
- 无连接池调优、重试/退避、迁移框架 — 仅 `schema.sql` + 应用自身的 `CREATE TABLE IF NOT EXISTS`。
