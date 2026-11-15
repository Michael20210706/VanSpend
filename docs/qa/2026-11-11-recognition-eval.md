# 收据识别准确率测评(2026-11-11)

目标: 给出 VanSpend 所用多模态模型识别小票的可量化准确率及其局限，并检验能否用一处提示词改动修复 issue #28(只印一行合计税时不拆 5/7；小费行被漏)。

标注约定: **[实测]** = 本次运行的数据直接给出；**[推断]** = 由实测数据推出，但样本不足以确证；**[猜测]** = 没有数据支撑。

## 结论(先看这里)

1. [实测] 25 张合成图(24 张小票 + 1 张非小票)，旧提示词、每张 1 次: 整张所有字段全对的小票 4/24 = 17%(Wilson 95% 区间 7–36%)。这个"整张全对"口径很严(商家、日期、每行金额/数量/是否计税、小计、GST、PST、总计全部对)。较宽的口径: 明细行 F1 0.975；小计/GST/PST/总计四个金额全对 15/24 = 63%(区间 43–79%)；总计(total)单项 24/24。
2. [实测] #28 在合成数据上复现: 4 张"只印一行合计税"的小票，旧提示词 4/4 都没拆对(3 张 gst=pst=0，1 张把整笔税放进 pst)；4 张餐厅/中文餐厅小票的小费行 4/4 被漏(其中 1 张把小费 8.00 当成了 pst)。同一张图重复 3 次输出完全一致(temperature=0)。
3. [实测] 新提示词(一处改动，见下)在同一批图上: 合计税四张里 gst+pst 之和对的从 1/4 升到 3/4，gst/pst 各自精确(±0.01)只有 1/4(模型自己算错了 5/12，例如 1.25 对 1.22)，仍有 1 张完全没拆；小费行提取 0/4 → 4/4。
4. [实测] 新提示词没有让"整张全对"变多(4/24 → 4/24)；它改变了哪几张全对: 失去 disc-01(折扣行的 taxable 变了)、cn-01("6罐"的 qty 变成 6)，得到 cn-03、mix-03。[推断] 这些翻转发生在标注本身有歧义的字段上(折扣行是否计税、品名里的包装数量)，不是税/小费规则造成的，但这属于"改提示词扰动了不相关字段"，无法用本次数据排除它会在别的图上朝坏的方向翻。
5. [实测] 小费行出现后，小计仍是印出的"小计"(不含小费)，所以 subtotal+gst+pst≠total 在餐厅小票上依旧 0/3 一致；提示词里"subtotal 为所有明细之和"这句模型没有照做。要让数据自洽需要改 `normalize()`(本次任务范围只限提示词，没做)。
6. **更新(合并前)**：提示词改动已在提交 `28444a7` 之后被还原，没有进入 main，也没有部署，因为整张全对没有改善、证据不足以支持上线，是否采用留给负责人决定(可 `git revert` 该还原提交或 cherry-pick `28444a7`)。以下是当时的原始记录。
6. 本次**提交**了提示词改动(单独一个提交，可单独 revert)，理由是目标缺陷有改善、明细 F1 与金额类指标没有下降；不提交的理由也成立(整张全对没变、有 2 张翻转)，由复核者决定。

## 测评对象与口径

- 被测对象: `src/openrouter.cjs` 的 `scanReceipt()`，即线上同一条链路(提示词 + `normalize()`)。评分用的是 `normalize()` 之后、App 实际入库的结构。
- 运行时生效的模型: `google/gemini-2.5-flash-lite`(读自 `config.model`，`.env` 的 `OPENROUTER_MODEL` 覆盖了 `config/config.json` 里默认的 `google/gemini-2.5-flash`)。[猜测] 线上和 QA 当时用的是同一个覆盖值；未核实。
- 参数: temperature=0，每次请求一张图，不重试语义错误，传输错误(fetch 失败/HTTP 非 2xx)重试 1 次且计入调用数。

## 数据集(合成，已知答案)

25 张图由 `eval/build-dataset.cjs`(答案和印刷行)+ `eval/render.swift`(渲染成 JPEG，固定随机种子)生成，图片在 `eval/images/`(约 3.1 MB)。税的口径: 商品标记 E=免税、G=仅 GST 5%、T=GST 5%+PST 7%，答案按小票自己印出的标记和规则算，不代表 BC 税法的全部细节(例如餐厅按只收 GST 处理，不含酒类 PST)。T&T 风格的合计税 = gst+pst 的和，所以真值的 5:7 拆分是精确可还原的(两项各自四舍五入到分，按 5/12、7/12 拆有 ±0.01 的取整可能)。

小费口径: 答案把小费当成一条明细(category 其他、taxable false)，subtotal = 所有明细之和(含小费)，这样 subtotal+gst+pst=total 成立；而小票本身印的"小计"不含小费。这是按 App 的数据模型(`normalize()`/编辑规则: subtotal=明细和)定的，不是小票的印法。

### 清单

| id | 组 | 商家 | 明细行(含小费行) | 印出的税 | 特征 | 日期写法有歧义 |
|---|---|---|---|---|---|---|
| costco-01 | costco | Costco | 7 | 分别印 GST / PST | — |  |
| costco-02 | costco | Costco | 8 | 分别印 GST / PST | — | 是 |
| tnt-01 | tnt-combined | T&T Supermarket | 6 | 只印 1 行合计税 | combined_tax |  |
| tnt-02 | tnt-combined | T&T Supermarket | 6 | 只印 1 行合计税 | combined_tax |  |
| tnt-03 | tnt-combined | T&T Supermarket | 7 | 只印 1 行合计税 | combined_tax | 是 |
| tnt-04 | tnt-combined | T&T Supermarket | 5 | 只印 1 行合计税 | combined_tax |  |
| rest-01 | restaurant-tip | Golden Palace Restaurant | 6 | 只印 GST | tip |  |
| rest-02 | restaurant-tip | Pasta Bella | 6 | 只印 GST | tip |  |
| rest-03 | restaurant-tip | Sushi Garden | 5 | 只印 GST | tip |  |
| disc-01 | discount-weighed | Real Canadian Superstore | 5 | 分别印 GST / PST | discount, weighed |  |
| disc-02 | discount-weighed | Save-On-Foods | 6 | 分别印 GST / PST | discount, weighed | 是 |
| disc-03 | discount-weighed | Walmart | 5 | 分别印 GST / PST | discount | 是 |
| cn-01 | chinese | 大统华超市 | 6 | 分别印 GST / PST | chinese |  |
| cn-02 | chinese | 华美海鲜酒楼 | 5 | 只印 GST | chinese |  |
| cn-03 | chinese | 百汇生鲜超市 | 7 | 分别印 GST / PST | chinese |  |
| mix-01 | mixed-tax | Shoppers Drug Mart | 5 | 分别印 GST / PST | gst_only |  |
| mix-02 | mixed-tax | Safeway | 6 | 分别印 GST / PST | gst_only |  |
| mix-03 | mixed-tax | London Drugs | 5 | 分别印 GST / PST | gst_only | 是 |
| deg-01 | degraded | Safeway | 5 | 分别印 GST / PST | tilt_noise | 是 |
| deg-02 | degraded | Superstore | 5 | 分别印 GST / PST | low_contrast |  |
| deg-03 | degraded | Costco | 5 | 分别印 GST / PST | photo_like |  |
| deg-04 | degraded | Walmart | 4 | 分别印 GST / PST | small_dim |  |
| long-01 | long | Superstore | 18 | 分别印 GST / PST | long |  |
| long-02 | long | Costco | 16 | 分别印 GST / PST | long | 是 |
| nonreceipt-01 | non-receipt | (非小票) | 0 | — | non_receipt |  |

降质图: deg-01 倾斜 4.5° + 噪点 + 模糊 + 不均匀光照 + 桌面背景；deg-02 低对比；deg-03 倾斜 -3° + 透视 + 噪点 + 模糊 + 光照 + 桌面 + JPEG 质量 0.55；deg-04 宽度缩到 360 px + 倾斜 + 重噪点/模糊 + 低对比 + JPEG 0.5。这些是用画布/Core Image 模拟的，不是手机实拍。

## 指标定义(`eval/score.cjs`，纯函数，有单测 `tests/eval-score.test.js`)

| 指标 | 定义 |
|---|---|
| 商家名匹配 | 去空格/标点、转小写后相等，或一方包含另一方(较短方 ≥2 字符) |
| 日期完全一致 | `purchased_at` 与答案字符串相等。注意 `normalize()` 在模型读不到日期时会静默填入"今天" |
| 明细行数一致 | 预测行数 = 答案行数 |
| 明细 P/R/F1 | 按金额(±0.01)一对一匹配；同金额多候选时优先数量也一致的。精确率 = 匹配数/预测行数，召回 = 匹配数/答案行数。按全部图的行汇总(micro) |
| qty / taxable 正确 | 只在已匹配的行上算；qty 容差 0.01；taxable 比较布尔值 |
| subtotal/gst/pst/total | 各自与答案相差 ≤0.01 |
| gst+pst 之和正确 | gst+pst 与答案之和相差 ≤0.01，不管拆分对不对 |
| 一致性 | \|subtotal+gst+pst−total\| ≤0.02(答案本身满足) |
| 分类有效 | 每行 category 在 `config.categories` 白名单内。注意这只是"合法"，**没有**和答案比对分类对不对 |
| 小费被提取 | 4 张有小费的小票里，小费那行金额被某个预测行匹配到 |
| 整张"完全正确" | 商家+日期都对，所有答案行都匹配、预测没有多余行、已匹配行 qty 和 taxable 全对，subtotal/gst/pst/total 全对 |
| Wilson 区间 | 95%；对小票图按"张"，对行按"行"。行不是独立样本(同一张图内相关)，所以行级区间偏窄 |

## 结果(首轮，每张 1 次)

### 整体(首轮 1 次/张; 小票图 24 张)

| 指标 | 基线(旧提示词) | 新提示词 |
|---|---|---|
| 商家名匹配 | 96% [80–99] (23/24) | 100% [86–100] (24/24) |
| 日期完全一致 | 88% [69–96] (21/24) | 88% [69–96] (21/24) |
| 明细行数一致 | 83% [64–93] (20/24) | 100% [86–100] (24/24) |
| subtotal ±0.01 | 79% [60–91] (19/24) | 83% [64–93] (20/24) |
| gst ±0.01 | 83% [64–93] (20/24) | 88% [69–96] (21/24) |
| pst ±0.01 | 79% [60–91] (19/24) | 88% [69–96] (21/24) |
| total ±0.01 | 100% [86–100] (24/24) | 100% [86–100] (24/24) |
| gst+pst 之和正确(不论拆分) | 83% [64–93] (20/24) | 96% [80–99] (23/24) |
| subtotal+gst+pst = total (±0.02) | 71% [51–85] (17/24) | 79% [60–91] (19/24) |
| 整张"完全正确" | 17% [7–36] (4/24) | 17% [7–36] (4/24) |
| 明细精确率(行) | 99% [95–100] (153/155) | 99% [96–100] (157/159) |
| 明细召回率(行) | 96% [92–98] (153/159) | 99% [96–100] (157/159) |
| 明细 F1 | 0.975 | 0.987 |
| 已匹配行 qty 正确 | 97% [93–99] (149/153) | 96% [91–98] (150/157) |
| 已匹配行 taxable 正确 | 91% [85–94] (139/153) | 95% [90–97] (149/157) |
| 分类在白名单内(行) | 100% [98–100] (155/155) | 100% [98–100] (159/159) |
| 小费行被提取(4 张有小费) | 0% [0–49] (0/4) | 100% [51–100] (4/4) |
| 非小票图返回空明细 | 1/1 | 1/1 |

区间很宽: 每个"张数"口径的分母只有 24。整张完全正确 4/24 的区间是 7–36%，不能据此区分 10% 与 30%。

### 分组(首轮; 格式 基线→新提示词, 正确数/张数)

| 组 | 张数 | 完全正确 | gst | pst | gst+pst 之和 | 一致性 | 小费被提取 | 明细 F1 |
|---|---|---|---|---|---|---|---|---|
| chinese | 3 | 1→1 /3 | 3→3 /3 | 2→3 /3 | 2→3 /3 | 3→2 /3 | 0→1 /1 | 0.97→1.00 |
| costco | 2 | 0→0 /2 | 2→2 /2 | 2→2 /2 | 2→2 /2 | 2→2 /2 | — | 1.00→1.00 |
| degraded | 4 | 0→0 /4 | 4→4 /4 | 4→4 /4 | 4→4 /4 | 3→4 /4 | — | 0.95→0.95 |
| discount-weighed | 3 | 1→0 /3 | 3→3 /3 | 3→3 /3 | 3→3 /3 | 3→3 /3 | — | 0.94→0.94 |
| long | 2 | 0→0 /2 | 2→2 /2 | 2→2 /2 | 2→2 /2 | 2→2 /2 | — | 1.00→1.00 |
| mixed-tax | 3 | 2→3 /3 | 3→3 /3 | 3→3 /3 | 3→3 /3 | 3→3 /3 | — | 1.00→1.00 |
| restaurant-tip | 3 | 0→0 /3 | 3→3 /3 | 3→3 /3 | 3→3 /3 | 0→0 /3 | 0→3 /3 | 0.90→1.00 |
| tnt-combined | 4 | 0→0 /4 | 0→1 /4 | 0→1 /4 | 1→3 /4 | 1→3 /4 | — | 1.00→1.00 |

### #28 合计税四张: 旧/新输出 vs 答案

| 图 | 答案 gst/pst | 旧 gst/pst | 新 gst/pst |
|---|---|---|---|
| tnt-01 | 1.22 / 1.71 | 0 / 2.93 | 1.25 / 1.68 |
| tnt-02 | 1.04 / 1.46 | 0 / 0 | 0 / 0 |
| tnt-03 | 1.62 / 2.27 | 0 / 0 | 1.62 / 2.27 |
| tnt-04 | 1.17 / 1.64 | 0 / 0 | 1.2 / 1.61 |

### 补充口径(同样来自首轮)

| 口径 | 基线 | 新提示词 |
|---|---|---|
| 日期，仅日期写法无歧义的 17 张 | 94% [73–99] (16/17) | 94% [73–99] (16/17) |
| 日期，写法有歧义的 7 张(MM/DD 且两段都 ≤12) | 5/7 | 5/7 |
| 小计/GST/PST/总计四个金额全对 | 63% [43–79] (15/24) | 71% [51–85] (17/24) |
| 明细行完全对(行数一致且全部匹配) | 75% [55–88] (18/24) | 92% [74–98] (22/24) |
| 去掉 #28 相关两组(合计税、小费)后，四个金额全对 | 88% [66–97] (15/17) | 94% [73–99] (16/17) |
| 整张全对，忽略有歧义的日期 | 21% [9–40] (5/24) | 21% [9–40] (5/24) |

### 运行间波动

6 张图(tnt-01、tnt-03、rest-01、disc-01、deg-01、long-01)各跑 3 次，旧、新提示词各一遍: **所有 12 组(6 图 × 2 个提示词)的 3 次输出，金额、数量、taxable 全部逐字段一致**。[实测] 在 temperature=0、同一提示词下，同一张图几乎没有采样随机性。[推断] 这意味着首轮 1 次/张的结果可以当作"该提示词在该图上的确定表现"，样本不足的问题在于**图的数量**(24 张)，不在于重复次数。[猜测] 上游服务商若更换模型版本，结果会变；本次期间观察到上游一次 429 限流(见调用数)，没有观察到输出漂移。

## 失败清单(旧提示词，按类别)

1. **#28 合计税不拆**(4/4): tnt-02/03/04 gst=0、pst=0，total 对但 subtotal+gst+pst≠total；tnt-01 把整笔 2.93 放进 pst，gst=0。新提示词后: tnt-03 精确拆对；tnt-01(1.25/1.68 对 1.22/1.71)、tnt-04(1.20/1.61 对 1.17/1.64)和之为对、拆分的算术偏 0.03；tnt-02 仍 0/0。
2. **小费行被漏**(4/4): rest-01/02/03 明细少 1 行，subtotal 为印出的小计，对不上 total；cn-02 把小费 8.00 填进了 pst(subtotal 78.5、gst 3.93、pst 8，**自洽但错**)，同时该张 4 行 taxable 全判 false。新提示词后: 4 张小费行都提取了，cn-02 的 pst 回到 0 且 taxable 全对；但 4 张的 subtotal 仍是印出的小计，所以一致性仍 0/3，cn-02 的一致性从 3/3 里的"自洽"变成不自洽。
3. **日期**: 旧新各错 3 张。costco-02(09/03/2026 被读成 2026-03-09)、disc-03(11/05/2026 被读成 2026-05-11)是 MM/DD 与 DD/MM 的歧义，我的数据集在这两张的写法本身有歧义；deg-04(小尺寸重噪点)返回空日期，`normalize()` 静默填成运行当天 2026-11-11，用户在界面上会看到一个看似合法的错日期。
4. **taxable 在没有标记的行上靠常识猜**: 14/153 行错(其中 4 行是 cn-02 餐厅的 GST 行被判免税，其余多为无标记行)。例如黄油、意面酱、烤鸡、咖啡、橙汁、鸡翅、莎莎酱被判应税(答案: 免税，小票上这些行没有 G/GP 标记)。[推断] 模型没有把"无标记 = 免税"当规则，这类错误在真实小票上的分布(那里有真实的 GST/PST 标记习惯)未知。
5. **折扣行**: disc-03 的"ROLLBACK -2.00"被读成名为 ROLLBACK LUNCH BOX 的一行且符号丢失(金额 +2.00，答案是 −2.00)；disc-02 的折扣行改名为 SALE DISCOUNT，且 taxable 判 false。
6. **低质图**(deg-04, 360 px + 重噪点): 品名乱码("HA WITH AN")、南瓜 5.00 读成 3.88、subtotal 偏 12.00，日期为空。
7. **qty**: costco-01 的 2×13.49 读成 qty 1；LIME 3CT 的 qty 读成 3(答案是 1，品名里的 3CT 是包装数量，答案的口径有歧义)。

## 提示词改动(只一处)

`src/openrouter.cjs` `buildPrompt()` 第 6 条。旧: "若小票只给了一个合计税(如 HST/Tax)，尽量按 5%/7% 比例拆分; 拆不出就把能确定的填上、其余填 0。" 新: 只印一个不区分 GST/PST 的合计税时必须按 5:7 拆(gst=合计×5/12，pst=合计×7/12，之和等于合计)；分别印了 GST/PST(或只印 GST)按印出的填；小费/服务费行作为一条明细(category 其他、taxable false)，并计入 subtotal(subtotal=所有明细之和)。同时导出 `buildPrompt` 供测试；新增 `tests/prompt.test.js`(旧提示词下 3 条红，新提示词全绿)。

## 局限(必读)

- [实测] 全部是**合成图**: 字体单一(Menlo/苹方)、版式规整、金额与税严格满足公式。真实手机照片的反光、折痕、透视、热敏纸褪色、小票断行与缩写，这里只用画布模拟了一小部分。**这个数不能当作真实照片上的准确率**；[推断] 真实照片上只会更低或相当，不会因此更高。
- [实测] 一个模型(运行时 gemini-2.5-flash-lite)，一个提示词(及其一处改动)。换成 config 里默认的 gemini-2.5-flash 或别的模型，数字都要重测，[猜测] 可能不同。
- 样本小: 24 张小票，每类 2–4 张。所有"X/24"的区间都在 ±15–20 个百分点量级；分组表里每组 2–4 张，只能当作"发生过"的证据，不能当作比例。"新提示词改善了 #28"在 4 张里是 gst+pst 之和 1→3，另有 1 张没变，不是统计显著结论。
- 新旧对比是**同一批图、各跑一次**。我没有留出独立验证集，提示词的措辞是看过基线失败样本后写的，所以新提示词在这 25 张上的数字是"调到目标上"的结果，对没见过的小票会偏乐观。
- 答案有歧义的字段(MM/DD 日期、品名里的包装数量、折扣行是否计税、无标记行的 taxable)会拉低所有指标，这是数据集设计的限制，我没有在跑完后改答案去迎合模型。
- 分类只检查"在白名单内"，没有和答案比对；**分类是否正确这次没有测量**。同样没有测 name_norm 的质量、单价、价格趋势匹配。
- 没有测: 手写小票、多语言混排(法语等)、跨页长小票、退货/退款小票、多种货币、一张图含多张小票。
- 非小票只测了 1 张(生日贺卡)，返回空明细；[推断] 单个样本不能说明对其他非小票图(如菜单、价目表)也这样。

## 费用: 真实调用次数

- 总计 **80 次** OpenRouter 调用(硬上限 120，未触及；计数文件 `eval/results/calls.json`)。分布: 基线 37 次(25 张首轮 + 6 张各多跑 2 次 = 37 个作业，0 次重试)；新提示词 43 次(37 个作业 + 5 次传输错误重试 + 1 次对限流失败的 costco-02 补跑)。重试的原因是上游 `gemini-2.5-flash-lite` 的 429 限流。
- 没有访问数据库、线上容器或公网域名；只在 worktree 根目录用 Node 直接调用 `scanReceipt`，没有读取或打印密钥。
- [实测] 单次延迟中位 2.1 s，最大 11.4 s。

## 怎么重跑

```bash
# 在本 worktree 或主仓库根目录(需要 .env 里有 OPENROUTER_API_KEY，会产生真实费用，约 37 次调用/轮)
node eval/build-dataset.cjs                    # 重新生成 eval/dataset.json
swiftc -O eval/render.swift -o /tmp/render && /tmp/render eval/dataset.json eval/images   # macOS; 重新渲染图片
node eval/run.cjs <label>                      # 结果写到 eval/results/<label>/；--only id1,id2 只跑部分；已成功的(id,run)会跳过
node eval/report.cjs <label>                   # 打印整体指标
node eval/compare.cjs baseline after           # 两轮逐张/分组对比
node eval/tables.cjs baseline after            # 生成本文的表格
npx vitest run --config eval/vitest.config.js  # 打分与提示词测试(不连数据库、不调用 OpenRouter)
```

`eval/run.cjs` 里写死了 120 次硬上限，换新的 label 重跑前先看 `eval/results/calls.json`(累计计数跨 label)。

## 范围边界

- 已知取舍与风险: 见"局限"。新提示词改动没有独立验证集；整张全对没有变好；小费行提取后 subtotal 仍不含小费，一致性没有改善。
- 严格约束: 只改了提示词(及 `buildPrompt` 的导出)和它的测试；没有改 `normalize()`、没有改任何路由、数据库、前端；没有新增依赖；没有 push、没有开 PR。
- 本阶段不包含: 在 `normalize()` 里对"gst=pst=0 但 total>subtotal"按 5:7 兜底拆分，以及"subtotal 不含小费时按明细重算"(issue #28 自己建议的第二点，能把 tnt-02 这类提示词修不动的情况和餐厅小费的不自洽都收住，建议单独做)；"读不到日期时不要静默填今天"；分类准确率；真实手机照片与真实用户小票的评测；独立验证集；多模型对比。

## 追加: normalize() 兜底拆分合计税(离线重放，零 API 调用)
`normalize()` 新增规则: `gst` 与 `pst` 都为 0，且印出的 `total` 比 `subtotal` 多出的部分不超过 `subtotal` 的 12%，就按 5:7 拆分(见 CLAUDE.md)。用 `node eval/replay.cjs baseline after` 把保存的 24 张首轮原始输出重新过一遍当前 `normalize()`。
- 基线(现行提示词): GST 正确 20/24 到 23/24，PST 19/24 到 22/24，`consistent` 17/24 到 20/24，整张全对 4/24 到 7/24。合计税小票 tnt-02、tnt-03、tnt-04 被修对，**没有任何一项从对变错**。**[测量]**
- 新提示词那一批(`after`)上: 整张全对 4/24 到 5/24，tnt-02 被修对，没有回归。**[测量]**
- tnt-01 没被修: 模型把整笔税填进了 pst 而不是 0/0，规则不覆盖这种形状。**[测量]**
- 局限: 同一批 24 张合成图，规则的 12% 上界来自 BC 税率(5% + 7%)而不是对这批数据调参，但我是在看过失败样本之后才想到这条规则的，对没见过的真实小票会偏乐观。区间仍然很宽。**[推断]**


## 第二轮(2026-11-12): pst 装整笔税的形状 + 小费提示词实验

### 本轮预先写下的验收规则(在任何新的 API 调用之前写的)

**(A) normalize() 规则**。`gst === 0`、`pst > 0`、印出的 `total` > 0、`|total - subtotal - pst| <= 0.02`、`pst <= subtotal × 12% + 0.05` 时，把 `pst` 当作合计税按 5:7 重拆。其余形状不动。这条规则是**看到 tnt-01 失败样本之后才写的**，不是事先设计的。

**(B) 小费提示词实验**。只改 `buildPrompt()` 第 6 条里关于小费的一句(小费行作为一条明细、category 其他、taxable false，subtotal 为含小费的明细之和)，其余提示词不动。对 25 张图各跑 1 次(`--extra 0`)，与基线(`eval/results/baseline` 的首轮原始输出)比较。两边都用**当前的 normalize()** 重新打分(`eval/experiment.cjs`)，这样 (A) 的效果不会混进提示词的效果里。比较口径是 24 张小票的首轮结果加 1 张非小票图。

只有同时满足下列全部条件，才提交提示词改动:
1. `tipFound` 高于基线(基线 0/4)。
2. 明细 F1、小计/GST/PST/总计四个金额各自的正确数、明细行 taxable 在匹配行上的正确率、整张全对的张数，每一项都**不低于**基线。
3. 基线里整张全对的小票，没有任何一张变成不对。

否则不提交提示词改动，实验的原始输出保留在 `eval/results/tip/`，报告写明不过的原因。若有小票的输出相对基线发生变化，允许对这些张再用基线提示词重跑一次作对照(区分提示词效果与上游模型漂移)。本轮真实调用硬上限 60 次，计数文件 `eval/results/calls-tax.json`。测试不调用 API。

**偏差声明**: 提示词措辞是看过基线失败样本(rest-01/02/03、cn-02 漏小费)后写的，数据集只有 24 张合成小票、4 张带小费；结果对没见过的真实小票会偏乐观，只给区间，不声明显著性。

### (A) 结果: pst 装整笔税的形状(离线重放，零 API 调用) [测量]

`node eval/replay.cjs baseline after`。表中"旧"是保存结果时的 normalize()(含当时尚未有的 #45 规则)，"新"是当前 normalize()。

| 批次 | 项 | 旧 | 新 |
|---|---|---|---|
| baseline(24 张) | gst 正确 | 20/24 | 24/24 |
| | pst 正确 | 19/24 | 23/24 |
| | consistent | 17/24 | 20/24 |
| | 整张全对 | 4/24 [7–36] | 8/24 [18–53] |
| after(旧版提示词改动那批，24 张) | 整张全对 | 4/24 | 5/24 |

- 变化的小票: baseline 里 tnt-01(0/2.93 到 1.22/1.71，与答案精确一致)、tnt-02、tnt-03、tnt-04；after 里只有 tnt-02。**回归(旧对、新错): 无。** 其中 tnt-02/03/04 是之前已合并的 #45 规则的效果，本轮新规则只改变了 tnt-01 一张。
- 新规则单独贡献 1 张/24 张，区间极宽；规则是看过 tnt-01 的失败之后写的，会偏乐观。
- 已知误伤风险 [推断]: 真实的"只收 PST、不收 GST"小票(如个别应税品类)会被拆成 5:7。BC 里几乎没有只收 PST 的零售小票，数据集里也没有这种样本，没有测量。

### (B) 结果: 小费提示词实验 [测量]

提示词改动(已回退，没有提交): 第 6 条后加一句 "小费/服务费(Tip、Gratuity、小费)那一行也要作为一条明细(category 其他，taxable 为 false，amount 为小费金额)。此时 subtotal 填所有明细 amount 之和(含小费行)，不要照抄小票上印出的小计，使 subtotal + gst + pst = total。" 原始输出在 `eval/results/tip/`。比较命令: `node eval/experiment.cjs baseline tip`(两边都经当前 normalize())。

| 指标(首轮, 24 张小票) | 基线 | 实验 | 验收 |
|---|---|---|---|
| tipFound | 0/4 [0–49] | 4/4 [51–100] | 改善 |
| 明细 F1 | 0.975 | 0.987 | 不差 |
| subtotal 正确 | 19/24 | 20/24 | 不差 |
| gst 正确 | 24/24 | 24/24 | 不差 |
| pst 正确 | 23/24 | 23/24 | 不差 |
| total 正确 | 24/24 | 24/24 | 不差 |
| taxable(匹配行) | 139/153 = 90.9% | 143/157 = 91.1% | 不差 |
| consistent | 20/24 | 21/24 | |
| 整张全对 | 8/24 [18–53] | 8/24 [18–53] | 不差 |
| **基线全对、实验变错** | | **disc-01** | **不通过** |

**验收规则第 3 条不通过，提示词改动不提交。** 差异明细:
- disc-01(没有小费的折扣小票): "DETERGENT COUPON -3.00" 的 taxable 从 true 变成 false，其余一字不差，整张从全对变错。
- 区分提示词效果与模型漂移: 用基线提示词重跑 disc-01 一次，taxable 仍是 true(control)；用实验提示词再跑一次，仍是 false(tip-rerun)。所以这是提示词引起的，不是漂移。[测量，各 1 次；以前观察到同提示词重复输出一致，温度 0]
- [推断] 新加的"taxable 为 false"字样被模型用到了折扣行上。这是猜测的机制，没有进一步实验。
- 另一个副作用: rest-02 的小费行被提取了，但小费同时仍被填进了 `pst`(pst=12，pst 变错)。consistent 因此 false 到 true，但 `pstOk` true 到 false；cn-02 相反(pst 对了，但 consistent 从 true 到 false)。小费被提取后 4 张里只有 rest-01/03 的税额没有受牵连。
- 其他单张变化(cn-03 的 storeOk、costco-01 的整张全对、deg-04 的 subtotal)在这一对比里没有提示词上的合理机制，[猜测] 是模型在 4 条输出之外的随机/上游差异；没有跟进。整体 24 张里净变化为 0(8 对 8)，并非提示词的收益。

### 本轮总结

- 真实 OpenRouter 调用 **28 次**(上限 60，计数文件 `eval/results/calls-tax.json`): 实验 25 + 对 disc-01 重跑 1 + 基线提示词对照 2(disc-01、rest-02)。没有访问数据库、线上或公网域名，没有读取或打印密钥。
- 合并内容: normalize() 的 pst 重拆规则(带测试)、`eval/experiment.cjs`(验收对比脚本)、`eval/run.cjs` 的每轮上限参数(`EVAL_HARD_CAP`、`EVAL_CALLS_FILE`)、实验原始输出。**提示词没有改。**
- 局限: 同一批 24 张合成图；4 张带小费；提示词是看过失败样本写的；实验和对照各只有 1 次。样本太小，不声明显著性。tipFound 4/4 对 0/4 的区间(51–100 对 0–49)不重叠，但这是 4 张里的 4 张。
- 仍未解决: 小费行被漏识别(用户界面上 subtotal 对不上 total)。可选下一步是在 normalize() 里处理"total 比 subtotal+gst+pst 多出一笔、且没有对应明细"(issue #28 的第二点)，或把小费作为另一个字段单独要求，而不是借用"明细 taxable=false"措辞；都需要新一轮测量，本轮没做。

### 怎么重跑本轮

```bash
export EVAL_HARD_CAP=60 EVAL_CALLS_FILE=calls-tax.json    # 本轮计数文件; 产生真实费用
node eval/run.cjs tip --extra 0                          # 需要先把上面的提示词句子加回 buildPrompt()
node eval/experiment.cjs baseline tip                    # 验收对比(零调用)
node eval/replay.cjs baseline after                      # 离线重放 normalize()
```

## 第三轮(2026-11-14): 日期标记(H-R2)与差额行(H-R1)，离线重放，零 API 调用

假设与验收规则事先写在 `docs/qa/2026-11-14-optimization-round.md` 第 3 节。两条都只改 `normalize()`(`src/openrouter.cjs`)及核对界面，不改提示词、不改线上模型。

测量工具: `node eval/replay.cjs --old-ref main baseline after`。本轮给 replay 加了 `--old-ref`(把"旧"列换成该 git 引用下的 `normalize()`，在内存里编译，不写文件)、分组表里的 tipFound 与"差额行 N/组内张数"、`date_guessed`/`residual_added` 两个名单；`eval/score.cjs` 的口径没动。不带 `--old-ref` 时"旧"列仍是结果保存时的输出(比 main 少两条税规则)，所以验收一律用 `--old-ref main`(`eb3f470`)。

验收批次是 `baseline`: 它是现行提示词(线上在用)的原始输出。`after` 是第一轮没上线的提示词那一批，只作旁证。每张 1 次、temperature=0；上一轮已测得同图重复输出逐字段一致，所以没有运行间波动可报，限制在**图的数量**(24 张合成小票，非小票图不计入)。

### H-R2 日期标记 [测量]

`normalize()` 读不到 `YYYY-MM-DD` 时仍填今天，但 `receipt.date_guessed = true`；`ScanTab` 的日期框旁显示"日期未识别，已填今天，请核对"，用户改日期后消失。保存/编辑接口在 `validate()` 里删掉 `date_guessed`/`residual_added`，返回的小票对象里没有这两个字段；入库本来就按列名写，标记也到不了库(`tests/recognition-flags.test.js`)。

| 验收 | 结果 |
|---|---|
| 重放里 deg-04 被标记，其余 23 张首轮结果不被标记 | 满足: baseline 与 after 两批都是 `date_guessed 的小票(1): deg-04(degraded)` |
| 端到端: 无日期时提示出现，有日期时不出现 | 满足: `e2e/recognition-hints.spec.js` 前 2 个用例 |
| 保存接口忽略该字段(不入库) | 满足: POST 带两个标记返回 200，`receipts` 行没有这两列，`raw_json` 不含，详情接口不返回 |
| 护栏: 任何数值指标不变 | 满足: `b285295`(只有 H-R2)的 `normalize()` 与 main 在 baseline+after 共 50 份原始输出上逐张比较，打分、明细、除 `date_guessed` 外的 receipt 字段 0 处不同 |

**结论: 上线。**

### H-R1 差额行 [测量]

规则: 税规则之后，印出的 `total` > 0、有明细、且 `total − (subtotal+gst+pst)` 取整到分后 > 0.02，加一条明细 `未识别差额(请核对)`(金额 = 差额，qty 1，category 其他，taxable 0)，`subtotal` 加上差额(= 明细之和)，`total` 不动，`receipt.residual_added = true`。差额为负、`total` 未印出、非小票(无明细)都不动。核对表下方提示"有一条未识别差额，请核对"。保存走 `validateSave`，它以 `total: 0` 调 `normalize()`，所以保存时不会再加一次。

| 验收(baseline 批，24 张首轮) | main | 本分支 | 结果 |
|---|---|---|---|
| `consistent` 餐厅组 0/3 → ≥2/3 | 0/3 | **3/3** | 满足 |
| `tipFound` 0/4 → ≥3/4(按金额匹配) | 0/4 | **3/4** | 满足。cn-02 没中: 模型把 8.00 小费填进了 pst，总额已自洽，规则不触发 |
| 基线里全对的小票没有一张变错 | 8/24 全对 | 11/24 全对，`回归(旧对、新错): 无` | 满足(rest-01/02/03 从不对变全对) |
| costco、tnt、mix、disc 组没有新增差额行 | | 差额行 costco 0/2、tnt-combined 0/4、mixed-tax 0/3、discount-weighed 0/3 | 满足 |
| 全量测试绿 | | `npm test` 562/562，端到端 79/79 两遍 | 满足 |

其他变化(baseline 批): `consistent` 20/24 → 24/24，`subtotalOk` 19/24 → 23/24，gst/pst/total/taxSum 不变。差额行一共 4 条: rest-01/02/03 和 deg-04。deg-04(小尺寸重噪点图，模型的 subtotal 少读了 12.00)得到一条 12.00 的差额行；它的品名本来就乱码，整张仍不对。long、chinese 两组也没有差额行。

**护栏与验收的冲突(需要负责人裁定)。** 护栏写的是"`subtotal`、`total` 不改"。`consistent` 的定义是 `subtotal+gst+pst` 与 `total` 差不超过 0.02(`eval/score.cjs`)。差额行规则不动 gst/pst；若 subtotal 和 total 也都不动，`consistent` 不可能变化，验收第一条无法成立。实测字面版本(删掉 `receipt.subtotal = ...` 那一行，其余不变): 餐厅组 `consistent` 0/3 → **0/3**，整张全对 8/24 → 8/24，tipFound 仍是 3/4，无回归。也就是说按字面护栏，H-R1 不满足第一条验收，应放弃。本分支的实现是让 subtotal 只随新增的明细同步，理由有三: 数据集答案里餐厅小票的 subtotal 本来就是含小费的明细之和(subtotalOk 0/3 → 3/3 说明了这一点)；保存接口按用户确认过的 subtotal 原样入库，不同步会存下"明细之和 64.50、税前 55.00"；编辑规则在第一次编辑时也会把它重算成明细之和。`total` 没有动。若负责人坚持字面护栏，`git revert` 实现提交 `e0a40d0` 即可(测试提交 `5b69d4f` 一起回退)。

已知风险 [测量，after 批]: 若模型已经把小费提取成一条明细、但 subtotal 仍抄印出的小计(第一轮没上线的提示词就是这种形状)，差额行会与小费行重复: after 批的 rest-01/02/03、cn-02 各多出一条与小费同金额的差额行(整张全对不变 5/24，consistent 20/24 → 24/24，subtotalOk 20/24 → 24/24，无回归，但这 4 张的条数多了 1)。现行提示词下(baseline 批)没有这种形状；真实小票上模型是否会同时做这两件事未测。

### 修复前失败的证据 [测量]

- H-R1: 把 `e0a40d0` 对 `src/openrouter.cjs` 的改动反向应用后跑 `tests/normalize.test.js`: `30 tests | 9 failed`，9 条全是差额行用例(如 `expected [ { name_raw: 'Dish', …(8) } ] to have a length of 2 but got 1`)。
- H-R2: 再把 `b285295` 对 `src/openrouter.cjs`/`src/receiptInput.cjs` 的改动反向应用: `30 tests | 12 failed`(另外 3 条是日期标记用例)。只反向 `receiptInput.cjs` 的两行删除: `tests/recognition-flags.test.js` 第 1 条失败；入库那条照样通过，因为入库按列名写，标记本来就到不了库。
- 端到端: 把 `components/ScanTab.js` 恢复成 main 的版本后跑 `e2e/recognition-hints.spec.js`: `2 failed, 1 passed`(两条提示 `element(s) not found`；"有日期时没有提示"那条本来就该通过)。

### 局限
- 同一批 24 张合成图、每张 1 次；餐厅组只有 3 张、带小费 4 张，"3/3"和"3/4"只是"发生过"的证据。差额行规则是看过 rest-01/02/03 的失败样本后写的，对没见过的小票会偏乐观。
- 规则把任何正向差额(漏读的一行、模型算错的 subtotal、小费)都变成同一条"未识别差额"，由人改名或删除；没有区分来源。
- 非小票图(nonreceipt-01)的 `purchased_at` 是空字符串，所以也带 `date_guessed`；它没有明细，保存接口要求至少一条明细，不影响入库。不在验收范围内。
- 日期只按 `YYYY-MM-DD` 形状判断: `2026-02-30` 这类形状对但不存在的日期不会被标记，保存时由 `validateSave` 挡成 400。本轮没改。
- 真实 OpenRouter 调用 **0 次**；没有访问线上库、线上容器或公网域名。

### 怎么重跑本轮
```bash
node eval/replay.cjs --old-ref main baseline after   # 零调用；看"分组"表(含差额行计数)、"回归"行和两个标记名单
npx vitest run tests/normalize.test.js tests/recognition-flags.test.js
E2E_PORT=<端口> MYSQL_DATABASE=<库名>_e2e_test npm run test:e2e -- e2e/recognition-hints.spec.js
```
