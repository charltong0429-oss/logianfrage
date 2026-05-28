# PRD: 物流询价邮件生成桌面应用

**版本:** 1.0
**日期:** 2026-03-16
**状态:** 草稿

---

## 1. 背景与目标

### 1.1 背景

当前工作流依赖一段 AppleScript 脚本：从 Excel 文件读取货物信息，经过若干对话框确认后，将德语询价邮件的主题和正文复制到剪贴板，再手动粘贴到邮件客户端发送给承运商（Dachser）。

该流程的主要痛点：
- 强依赖 Microsoft Excel，必须预先打开正确的文件
- 每次操作需经历多个系统对话框，交互繁琐
- 无法直接发送邮件，需手动粘贴
- 不可在 Windows 或其他系统上运行

### 1.2 目标

构建一个跨平台桌面应用，替代现有 AppleScript 流程，具备：
- 表单化数据输入（支持手动填写 + Excel 导入）
- 实时预览生成的询价邮件
- 一键调用系统邮件客户端发送邮件

---

## 2. 用户角色

| 角色 | 描述 |
|------|------|
| 物流跟单员 | 主要用户，负责根据货物信息向承运商发起运费询价 |

---

## 3. 功能需求

### 3.1 数据输入表单

表单包含以下字段，所有字段均支持手动输入，也可通过 Excel 导入自动填充：

| 字段 | Excel 单元格 | 说明 |
|------|------------|------|
| 托盘数 (Pallets) | D13 | 货物托盘数量，例如 `2 pallets` |
| 尺寸 (Dimensions) | D14 | 长×宽×高，例如 `120x80x100 cm` |
| 装载米数 (Loading Meters) | D16 | 例如 `0.8 ldm` |
| 重量 (Weight) | D17 | 单位 kg，例如 `500 kg` |
| 地址行1 (Street) | D22 | 收货方街道地址 |
| 地址行2 (Zip + City) | D23 | 邮编和城市，例如 `12345 Berlin` |
| 地址行3 (Country) | D24 | 国家名称，例如 `Germany` |

**收件人邮箱**字段（可编辑，位于表单顶部，不来自 Excel）。

### 3.2 选项配置

| 选项 | 类型 | 说明 |
|------|------|------|
| 是否含电池 | 单选 (是/否) | 影响发货地址与是否附加危险品声明 |
| 是否保价 | 单选 (是/否) | 若是，需额外输入保价金额（欧元） |

**发货地址规则：**
- 含电池 → `Ankerkade 18, 5928 PL Venlo, the Netherlands`
- 不含电池 → `Celsiusweg 66, 5928 PR Venlo, the Netherlands`

### 3.3 Excel 导入

- 点击"导入 Excel"按钮，打开文件选择器（支持 `.xlsx` / `.xls`）
- 使用 `xlsx` 库解析文件，读取 Sheet 1 中的指定单元格
- 自动填充对应表单字段
- 导入后字段仍可手动编辑

### 3.4 邮件内容生成

#### 主题行模板

```
Anfrage Transport - {pallets} {weight} ab NL {zip_from} nach -{zip_to}  - Unsere Kunden# 47035335
```

- `zip_from`：发货地址中的邮编（第5个单词）
- `zip_to`：地址行2中的第一个单词（邮编）

#### 正文模板（德语）

```
Guten Tag Team Dachser,

bitte senden Sie uns ein Angebot für den Transport von {pallets} wie folgt:

Loading Address * {shipFrom}
Pallets count * {pallets}{batteryNote}
Pallet size-L*W*H * {dimensions}
Pallet exchange--Yes/No *
Loading meters 　{cbm}
Total Weight--kg * {weight}
Contact *

UnLoading Ref No. *
Consignee--company name *
Address * {address1}, {address2}, {address3}
Post code/City * {zip} {address2}
Country * {address3}

inkl. automatischer Zustellankündigung,
{insuranceText}

{dgNote}
```

**变量说明：**

| 变量 | 规则 |
|------|------|
| `batteryNote` | 含电池时附加 ` of Battery`，否则为空 |
| `insuranceText` | 保价时为 `inkl. Transportversicherung Warenwert {amount} euro.`，否则为空 |
| `dgNote` | 含电池时附加危险品声明（见下方），否则为空 |

**危险品声明（dgNote）：**

```
Die Sendung beinhaltet Gefahrgut.
GG-Gewicht  {weight}
UN3480
Verpackungsklasse 9 2E
```

### 3.5 邮件发送与辅助操作

| 操作 | 说明 |
|------|------|
| 发送邮件 | 调用系统默认邮件客户端（`mailto:` 协议），预填收件人、主题、正文 |
| 复制主题 | 将主题行复制到剪贴板 |
| 复制正文 | 将正文复制到剪贴板 |
| 重置 | 清空所有表单字段，恢复默认状态 |

### 3.6 实时预览

- 界面右侧展示实时生成的邮件主题和正文
- 任何表单字段或选项变化后立即更新预览
- 预览区域支持滚动

---

## 4. 非功能需求

| 需求 | 说明 |
|------|------|
| 跨平台 | 优先支持 macOS，兼容 Windows |
| 无需网络 | 完全本地运行，不依赖后端服务 |
| 无需安装 Excel | Excel 解析通过 `xlsx` 库在本地完成 |
| 启动速度 | 冷启动时间 < 3 秒 |
| 安装包大小 | 目标 < 150 MB |

---

## 5. 技术栈

| 层级 | 选型 |
|------|------|
| 桌面框架 | Electron (latest stable) |
| 前端框架 | React 18 + TypeScript |
| 构建工具 | Vite (via `electron-vite`) |
| 样式 | Tailwind CSS |
| Excel 解析 | `xlsx` (SheetJS) |
| 打包 | `electron-builder` |

---

## 6. 界面布局

```
┌─────────────────────────────────────────────────────────────┐
│  收件人邮箱: [________________________]                        │
├──────────────────────────┬──────────────────────────────────┤
│  LEFT: 输入表单           │  RIGHT: 邮件预览                  │
│                          │                                   │
│  [导入 Excel]             │  主题:                            │
│                          │  ┌──────────────────────────────┐ │
│  托盘数: [________]       │  │ Anfrage Transport - ...      │ │
│  尺寸:   [________]       │  └──────────────────────────────┘ │
│  装载米: [________]       │                                   │
│  重量:   [________]       │  正文:                            │
│                          │  ┌──────────────────────────────┐ │
│  地址行1:[________]       │  │ Guten Tag Team Dachser,      │ │
│  地址行2:[________]       │  │ ...                          │ │
│  地址行3:[________]       │  │                              │ │
│                          │  └──────────────────────────────┘ │
│  含电池: ○是 ●否          │                                   │
│  保  价: ○是 ●否          │  [复制主题] [复制正文]             │
│                          │                                   │
│  [重置]    [发送邮件]      │                                   │
└──────────────────────────┴──────────────────────────────────┘
```

---

## 7. 项目结构

```
src/
├── main/                    # Electron 主进程
│   └── index.ts
├── preload/                 # 预加载脚本
│   └── index.ts
└── renderer/                # React 渲染进程
    ├── App.tsx
    ├── components/
    │   ├── InquiryForm.tsx   # 左侧输入表单
    │   └── EmailPreview.tsx  # 右侧邮件预览
    ├── hooks/
    │   └── useEmailTemplate.ts  # 邮件内容生成逻辑
    └── utils/
        ├── excelParser.ts    # Excel 文件解析
        └── emailBuilder.ts   # 主题/正文拼接
```

---

## 8. MVP 范围

**包含：**
- 完整表单输入
- Excel 文件导入（Sheet 1，固定单元格）
- 邮件主题 + 正文生成
- 实时预览
- `mailto:` 发送 + 剪贴板复制
- macOS 打包（`.dmg`）

**不包含（后续迭代）：**
- SMTP 直接发送（无需打开邮件客户端）
- 多承运商模板切换
- 历史记录
- Excel 单元格自定义映射

---

## 9. 验收标准

1. 手动填写所有字段后，点击"发送邮件"能正确打开系统邮件客户端并预填内容
2. 导入一个标准格式的 `.xlsx` 文件后，7 个字段全部正确填充
3. 含电池时，正文包含危险品声明且发货地址为 Ankerkade
4. 不含电池时，正文无危险品声明且发货地址为 Celsiusweg
5. 保价金额正确嵌入正文
6. 重置后所有字段清空
7. 实时预览随表单修改即时更新
