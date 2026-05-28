# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**LogiAnfrage** is a two-app logistics inquiry management system:

- **M (MasterApp)** — Electron desktop app (root directory). Internal operations tool for managing inquiries, sending emails, handling PDFs, and syncing with Notion.
- **S (SlaveApp)** — Vercel-deployed web app (`slave-app/`). Mobile/browser-accessible interface for field staff to submit new inquiries and track status.

The two apps share a **Notion database** as the single source of truth. There is no direct M↔S connection; all data flows through Notion.

---

## Commands

### MasterApp (Electron)

```bash
# Development (hot reload)
npm run dev

# Build (outputs to out/)
npm run build

# Package as macOS .dmg (universal)
npm run package

# Package for specific arch
npm run package:arm64
npm run package:x64
```

### SlaveApp (Vercel / Vite)

```bash
cd slave-app

# Development
npm run dev

# Build (outputs to dist/)
npm run build

# Deploy to production
cd slave-app && vercel --prod
```

No linting or test scripts are configured in either app.

---

## MasterApp Architecture

### IPC Communication Pattern

All renderer↔main communication uses Electron IPC. The pattern is strictly:

```
Renderer (React) → window.api.xxx() → preload/index.ts (contextBridge) → ipcMain handler in main/index.ts → service modules
```

`window.api` is typed via `src/renderer/env.d.ts`. Every API surface must be declared in both `src/preload/index.ts` (runtime bridge) and `src/renderer/env.d.ts` (TypeScript types).

### Main Process Services

| File | Responsibility |
|------|---------------|
| `src/main/index.ts` | All `ipcMain.handle()` registrations; app lifecycle |
| `src/main/notionService.ts` | Notion API (config r/w, CRUD, property schema check) |
| `src/main/folderService.ts` | Local filesystem: folder naming/scanning, `.logianfrage.json` meta files |
| `src/main/emailService.ts` | SMTP send (nodemailer), IMAP fetch (imapflow), email cache (UID-based incremental) |
| `src/main/pdfService.ts` | PDF parsing: Preisangebot, Rechnung, Speditionsauftrag (via pdf-parse) |

**Config persistence**: `logianfrage-config.json` in `app.getPath('userData')`. Read via `readAppConfig()`, written via `saveAppConfig()`.

**Email cache**: `email-cache.json` in userData. Version 2 format with per-folder `highestUid`/`uidValidity` for incremental IMAP scanning.

**Notification state**: `notion-notified.json` in userData. Tracks which Notion page IDs have already triggered system notifications for 已报价 status.

### Renderer Tabs

`src/renderer/App.tsx` manages four tabs:

- `overview` → `PilotView.tsx` — dashboard/summary
- `records` → `RecordsTab.tsx` — inquiry list + detail panel (main workflow)
- `email` → `EmailTab.tsx` — IMAP inbox + drag-to-bind email→inquiry
- `settings` → `NotionSettingsTab.tsx` + inline email/folder config in `App.tsx`

### Folder Naming Convention

Archive folders follow the format: `/YYYY/YYYY.MM/DD CC TYPE I`

- `CC` = two-letter country code
- `TYPE` = INV / BATT / ACC
- `I` = Roman numeral (I, II, III...) for same-day duplicates

Each folder contains a `.logianfrage.json` (`FolderMeta`) with Notion page ID, Angebot#, Pickup#, type, country, date.

---

## SlaveApp Architecture

### Routing

React Router SPA with password-gate (`slaveapp_pwd` in localStorage):

- `/login` → `LoginPage.tsx`
- `/list` → `ListPage.tsx` (month-accordion inquiry list)
- `/new` → `NewInquiryPage.tsx` (form → POST `/api/records`)
- `/detail/:id` → `DetailPage.tsx` (per-record detail + Excel download)

### API Layer

Vercel Functions in `slave-app/api/`:

| File | Endpoint |
|------|----------|
| `records.ts` | `GET/POST /api/records` |
| `auth.ts` | `POST /api/auth` |
| `normalize-address.ts` | `POST /api/normalize-address` (OpenRouter AI) |
| `_utils.ts` | Shared: Notion client, `parseNotionPage`, `richText` |

All API calls from the frontend go through `slave-app/src/api/client.ts` (`apiFetch`), which injects `x-app-password` from localStorage and handles 401 redirects.

`vercel.json` has a catch-all SPA rewrite: all non-`/api/` paths → `index.html`.

### Environment Variables (SlaveApp on Vercel)

- `NOTION_TOKEN` — Notion integration token
- `NOTION_DATABASE_ID` — target database
- `APP_PASSWORD` — shared password checked via `x-app-password` header
- `OPENROUTER_TOKEN` — for AI address normalization

---

## Shared Data Model

`NotionRecord` is defined in two places (kept in sync manually):

- **M**: `src/renderer/utils/types.ts`
- **S**: `slave-app/src/utils/types.ts` + `slave-app/api/_utils.ts`

Key fields: `notionPageId`, `date` (YYYY.MM.DD), `type` (INV/BATT/ACC), `country` (2-letter), `status` (5-step flow), `angebotnummer`, `rswCode` (Pickup#), `amount`, `rechnungAmount`.

**eLOG tracking**: credentials are `angebotnummer / rswCode`, used directly at `elogistics.dachser.com`. No separate tracking# field is needed.

---

## Notion 属性列同步维护

当 Notion 数据库属性列发生变更（新增、删除、改名、改类型）时，需同步更新以下四处：

1. **`src/main/notionService.ts` → `EXPECTED_PROPS`**
   添加/删除/修改对应条目（`{ name, type }`），这是"检测属性列"按钮的基准。

2. **`src/main/notionService.ts` → `parseNotionPage`**
   在返回对象中添加对应字段读取（用 `getText` / `getSelect` / `getNumber` / `getDate`）。

3. **`src/renderer/utils/types.ts` → `NotionRecord` interface**
   添加对应字段及类型（`string | null`、`number | null` 等）。

4. **（如需写回）`src/main/notionService.ts` → `updatePage`**
   在 properties 构建逻辑中加上新字段的写入分支。

> S 端若也读取该字段，还需同步更新 `slave-app/api/_utils.ts` 的 `parseNotionPage` 和 `slave-app/src/utils/types.ts` 的 `NotionRecord`。
