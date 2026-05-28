import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { Client } from '@notionhq/client'
import {
  fetchAllRecords, fetchRecord, createRecord, updateRecord,
  type CreateRecordParams, type UpdateRecordParams, type NotionConfig,
} from './notionService'

// ── Config (stored in userData, never hardcoded) ──────────────────

interface SlaveConfig {
  notion?: NotionConfig
  openrouterToken?: string
}

function getConfigPath(): string {
  return join(app.getPath('userData'), 'slave-config.json')
}

function readConfig(): SlaveConfig {
  try {
    const p = getConfigPath()
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf-8')) as SlaveConfig
  } catch { /* ignore */ }
  return {}
}

function saveConfig(cfg: SlaveConfig): void {
  writeFileSync(getConfigPath(), JSON.stringify(cfg, null, 2), 'utf-8')
}

// ── Window ────────────────────────────────────────────────────────

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 800,
    minHeight: 600,
    icon: join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false,
  })

  win.on('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ── IPC: Config ───────────────────────────────────────────────────

ipcMain.handle('slave:getConfig', () => {
  return readConfig()
})

ipcMain.handle('slave:saveConfig', (_e, notion: NotionConfig, openrouterToken?: string) => {
  try {
    const cfg = readConfig()
    cfg.notion = notion
    if (openrouterToken !== undefined) cfg.openrouterToken = openrouterToken
    saveConfig(cfg)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

ipcMain.handle('slave:testConnection', async (_e, notion: NotionConfig) => {
  try {
    const client = new Client({ auth: notion.token })
    await client.databases.retrieve({ database_id: notion.databaseId })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

// ── IPC: Records ──────────────────────────────────────────────────

ipcMain.handle('slave:getRecords', async () => {
  const cfg = readConfig()
  if (!cfg.notion) return { ok: false, error: '未配置 Notion', records: [] }
  try {
    const records = await fetchAllRecords(cfg.notion)
    return { ok: true, records }
  } catch (e) {
    return { ok: false, error: String(e), records: [] }
  }
})

ipcMain.handle('slave:getRecord', async (_e, pageId: string) => {
  const cfg = readConfig()
  if (!cfg.notion) return { ok: false, error: '未配置 Notion', record: null }
  const record = await fetchRecord(cfg.notion, pageId)
  return record ? { ok: true, record } : { ok: false, error: '记录不存在', record: null }
})

ipcMain.handle('slave:createRecord', async (_e, params: CreateRecordParams) => {
  const cfg = readConfig()
  if (!cfg.notion) return { ok: false, error: '未配置 Notion' }
  return createRecord(cfg.notion, params)
})

ipcMain.handle('slave:updateRecord', async (_e, pageId: string, params: UpdateRecordParams) => {
  const cfg = readConfig()
  if (!cfg.notion) return { ok: false, error: '未配置 Notion' }
  return updateRecord(cfg.notion, pageId, params)
})

ipcMain.handle('slave:normalizeAddress', async (_e, raw: string) => {
  const cfg = readConfig()
  const token = cfg.openrouterToken
  if (!token) return { ok: false, error: 'OpenRouter API Key 未配置' }
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://logianfrage.app',
        'X-Title': 'LogiAnfrage',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        temperature: 0,
        messages: [{
          role: 'user',
          content:
            'Parse this shipping address into JSON with exactly 4 fields:\n' +
            '- street: street name and house number only\n' +
            '- postalCode: the postal/zip code\n' +
            '- city: the city name\n' +
            '- country: 2-letter ISO code (e.g. FR, DE, IT)\n\n' +
            'Return only valid JSON, no markdown, no explanation.\n\n' +
            `Address: ${raw}`,
        }],
      }),
    })
    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>
      error?: { message: string }
    }
    if (data.error) return { ok: false, error: data.error.message }
    const content = (data.choices?.[0]?.message?.content ?? '').replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(content)
    return { ok: true, data: parsed }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})
