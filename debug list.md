# Debug List

> 约定：M = MasterApp，S = SlaveApp

## 待处理

### 综合

- Notion 属性列变更时需手动同步更新 `notionService.ts` 中的 `EXPECTED_PROPS` 常量
- [ ] 5个状态为：需询价、已询价、已报价、已要求提货、已收账单，为了简便，我们在对话和文档记录中，称之为，A/B/C/D/E

### 呼吸灯机制

#### S 端（SlaveApp / Web）

- **出现条件**：列表行中，记录状态为 `已报价`，且其 `notionPageId` 不在 `localStorage` 的 `liq_seen_v2` 集合中
- **表现形式**：列表首列出现绿色圆点，CSS class `animate-pulse`（Tailwind pulse 动画）
- **熄灭时机**：用户点击该行进入详情页时，`markSeen(id)` 立即将该 ID 写入 `liq_seen_v2`，列表重新渲染后圆点消失
- **持久化**：`liq_seen_v2` 存于 `localStorage`，跨会话保持；清除浏览器数据会导致所有已报价记录重新亮灯

#### M 端（MasterApp / Electron）

- **出现条件**：列表行状态为 `待询价`（A）或 `已要求提货`（D）时亮灯
  - A：记录刚创建，需要 M 端操作员发询价邮件；亮灯直到 Notion 状态变为 B（已询价）
  - D：S 端同事输入 Pickup# 提交后 Notion 状态变为 D，M 端需跟进；亮灯直到操作员在详情页点击 **”标记已要求提货”** 本地确认
- **表现形式**：列表行左侧出现红色圆点，CSS class `animate-pulse`
- **熄灭时机**：
  - A → Notion 状态变为 B 后，列表刷新自动消失
  - D → 操作员复制邮件文字、自行发送邮件后，在详情页点击”标记已要求提货”；**Notion 状态保持 D 不变**；确认 ID 写入 localStorage `liq_pickup_ack_v1`，下次渲染即熄灭。Notion 状态在导入账单（Rechnung PDF）后才变为 E（已收账单）
- **通知机制（独立于呼吸灯）**：Electron 系统通知由 `notion-notified.json`（userData 目录）记录已推送过通知的 ID；启动后 30 秒首次检测，之后每 3 分钟轮询，检测到新 `已报价`（C）记录时触发系统通知

- [ ] S的单条，可以完全抄M端，区别于M的功能：

### M-询价管理
- ~~上方的4个文件拖入框做成1个~~ ✓ 统一拖入框，PDF 拖入后弹出 Angebot/Auftrag/Invoice 选择模态框
- ~~询价管理这里4个功能放到下拉菜单~~ ✓ "工具 ▼" 下拉菜单

### S-列表

- ~~国家增加国旗~~ ✓

### S-询价单

- ~~尺寸格式校验 bug~~ ✓ DIM_RE 正则修复

---

## 已完成

### 综合

- 在必要时可使用 Openrouter API 调用 AI
  - S（Vercel）：环境变量 `OPENROUTER_TOKEN`
  - M（Electron）：`main/index.ts` 读取 `process.env.OPENROUTER_TOKEN`

### S-列表

- 列表双行显示，首列着重体现 Pickup#（rswCode 橙色粗体 mono，显示在日期下方）
- 首列呼吸灯：已报价未读时显示，打开详情后消失（`liq_seen_v2` localStorage 追踪）
- 系统级通知（S/M 独立，互不依赖）
  - S：浏览器 `Notification` API，每3分钟轮询，检测新"已报价"触发通知
  - M：Electron `Notification`，启动30秒后首次检测，之后每3分钟轮询，通知记录存入 `notion-notified.json`
- 月份按手风琴规则展开（同时只展开一个月，默认最新）
- 已要求提货条目详情中显示 Pickup# 和 eLOG 跟踪凭据
- Tracking 跟踪方式：Angebot# / RSW 码拼合，通过 DACHSER eLOG（elogistics.dachser.com）直接查询

### S-询价表单

- 表单自上而下：Excel 拖入框、货物类型下拉、目的国下拉（两位字母 - 中文名）
- 收件地址大输入框 + "解析地址"按钮（AI 解析填入各字段）
- 字段：街道地址[可选]、邮编[必须]、城市[必须]、省/州[可选]、托盘数[必须，默认1]
- 货物尺寸（m）：托盘数 N → N 个输入框，格式校验 1.23*1.23*1.23 m，多托用逗号分隔存 Notion
- Inquiry Form Excel：S 端详情页可直接下载，含全部询价数据

### M-页面结构

- SideBar + Main 区域：Logo / 纵览 / 询价管理 / 邮件匹配 / 设置
- 设置 → 本地硬盘路径
- 设置 → Notion 集成：Token + Database ID + 连接测试 + 属性列检测（显示缺失/类型不匹配/额外列）
- 设置 → 邮件账号：SMTP/IMAP 配置、默认收件人、邮件签名、收件关键词过滤（逗号分隔，默认 `dachser`）

### M-询价管理

- 询价列表：按月手风琴聚合，默认展开最新月
- 状态流转：待询价 → 已询价 → 已报价 → 已要求提货 → 已收账单
- 文件夹格式：`/YYYY/YYYY.MM/DD CC TYPE I`，"规范化名称"工具批量重命名旧格式
- 询价列表行：国旗 + 国家 + 日期 + 状态（行1）；托盘数 + 类型 + 重量 + 报价（行2）；Pickup# 橙色 mono（行3）
- 详情面板：基础信息、货物属性、报价/账单信息、地址
- 待询价：收件人 + 主题 + 正文编辑 + 发送询价邮件按钮
- 已报价："再次询价"按钮（展开邮件表单可编辑后重发）
- 已要求提货：提货邮件一键发送（自动附 Speditionsauftrag，BATT 提示补 Gefahrgut）；eLOG 凭据显示 + 跳转链接
- PL（装箱单）：本地硬盘管理，由 M 端拖入文件夹
- Inquiry Form Excel：M 端"生成 Excel"按钮，自动保存到本地文件夹（无文件夹时弹出保存对话框）
- 询价邮件格式：主题 `Anfrage Transport - N Pallets TYPE W kg ab ... nach ...`，正文已清理占位符

### M-邮件收发

- SMTP/IMAP 双向收发，已发送邮件显示（→ 标记）
- 邮件列表 + 详情 + 附件一键"导入询价"
- 邮件缓存（UID 增量扫描）：冷启动立即显示缓存，后台增量刷新，"清空缓存"强制全量扫描，显示"上次扫描"时间戳

### M-邮件匹配

- 邮件 Tab 左侧询价面板：显示 Pickup#、国旗+国家、日期、类型、托数，悬停3秒显示详情 Tooltip
- 拖拽绑定：有 PDF 附件的邮件可拖到左侧询价记录，自动提取 Preisangebot 并关联，含加载/成功/失败反馈
