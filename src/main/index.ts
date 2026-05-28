import { app, BrowserWindow, ipcMain, dialog, shell, clipboard, nativeImage, Notification as ElectronNotification } from 'electron'
import { join, basename } from 'path'
import { spawn } from 'child_process'
import { copyFileSync, existsSync, writeFileSync, readdirSync } from 'fs'
import * as XLSX from 'xlsx'

import {
  createArchiveFolder,
  renameFolderAppend,
  moveFilesToFolder,
  copyFileToFolders,
  scanFolders,
  findFolderByAngebotnummer,
  readFolderMeta,
  writeFolderMeta,
  planFolderRenames,
  executeFolderRenames,
  normalizeCountry,
} from './folderService'
import { extractAngebotnummer, extractRechnungData, extractPreisangebotData, fillSpeditionsauftrag, parsePlPdf, fillAuftragFromPl } from './pdfService'
import type { SpeditionsauftragData, PreisangebotData, RechnungData } from './pdfService'
import {
  readAppConfig,
  saveAppConfig,
  testConnection,
  createPage,
  updatePage,
  fetchAllRecords,
  fetchRecord,
  checkDatabaseProperties,
} from './notionService'
import type { CargoType, NotionRecord, EmailConfig } from '../renderer/utils/types'
import type { UpdatePageParams } from './notionService'
import { sendEmail, testSmtp, testImap, fetchInbox, fetchMessageDetail, saveAttachmentToTemp, listMailboxFolders, fetchAllDachserEmails, fetchDachserEmailsIncremental, loadEmailCache, clearEmailCache } from './emailService'
import type { SendEmailOptions } from './emailService'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    title: 'LogiAnfrage',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // Set custom Dock icon in dev mode (packaged app uses Info.plist icon automatically)
  if (!app.isPackaged && process.platform === 'darwin') {
    const iconPath = join(__dirname, '../../build/icon.png')
    try {
      const img = nativeImage.createFromPath(iconPath)
      if (!img.isEmpty()) app.dock?.setIcon(img)
    } catch { /* ignore if not available */ }
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  // 启动后台轮询：检测新的已报价条目，触发系统通知
  startNotificationPoller()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ── 后台轮询：已报价通知 ──────────────────────────────────────────

const NOTIF_FILENAME  = 'notion-notified-v2.json'  // v2: composite keys "${pageId}:${status}"
const NOTIF_INTERVAL  = 3 * 60 * 1000  // 3 分钟

// 每个需通知状态对应的标题与正文生成函数（M 端：内部运营视角）
interface NotifConfig { title: string; body: (r: NotionRecord) => string }
const NOTIFY_STATUSES: Record<string, NotifConfig> = {
  '待询价': {
    title: 'LogiAnfrage — 要求询价',
    body: (r) => {
      const pallets = r.pallets != null ? `${r.pallets}托` : ''
      return `${r.country} ${pallets}${r.type}，有新询价请求待处理`
    },
  },
  '要求出货': {
    title: 'LogiAnfrage — 要求出货',
    body: (r) => {
      const pallets = r.pallets != null ? `${r.pallets}托` : ''
      return `${r.country} ${pallets}${r.type}，客户已提交出货请求`
    },
  },
}

function loadNotifiedIds(userData: string): Set<string> {
  const { existsSync: fe, readFileSync: rf } = require('fs') as typeof import('fs')
  try {
    const p = join(userData, NOTIF_FILENAME)
    if (!fe(p)) return new Set()
    return new Set(JSON.parse(rf(p, 'utf-8')) as string[])
  } catch { return new Set() }
}

function saveNotifiedIds(userData: string, ids: Set<string>): void {
  const { writeFileSync: wf } = require('fs') as typeof import('fs')
  try { wf(join(userData, NOTIF_FILENAME), JSON.stringify([...ids]), 'utf-8') }
  catch { /* ignore */ }
}

async function pollForStatusChanges(): Promise<void> {
  const config = readAppConfig(app.getPath('userData'))
  if (!config.notion) return

  try {
    const records  = await fetchAllRecords(config.notion)
    const notified = loadNotifiedIds(app.getPath('userData'))
    let changed    = false

    for (const [status, cfg] of Object.entries(NOTIFY_STATUSES)) {
      const newOnes = records.filter(
        r => r.status === status && !notified.has(`${r.notionPageId}:${status}`)
      )
      for (const r of newOnes) {
        try {
          new ElectronNotification({ title: cfg.title, body: cfg.body(r) }).show()
        } catch { /* 部分 Linux 环境可能不支持通知 */ }
        notified.add(`${r.notionPageId}:${status}`)
        changed = true
      }
    }
    if (changed) saveNotifiedIds(app.getPath('userData'), notified)
  } catch { /* ignore — Notion 不可达时静默失败 */ }
}

function startNotificationPoller(): void {
  // 启动 30 秒后首次检测（等待 Notion 配置加载完成）
  setTimeout(() => {
    pollForStatusChanges()
    setInterval(pollForStatusChanges, NOTIF_INTERVAL)
  }, 30_000)
}

// ── 地址解析工具 ──────────────────────────────────────────────────

function toTitleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}

function parseFullAddressLine(
  raw: string,
  countryFromD24: string
): { street: string; postcode: string; city: string } {
  let cleaned = raw.trim()
  const cLower = countryFromD24.trim().toLowerCase()
  if (cLower && cleaned.toLowerCase().endsWith(cLower)) {
    cleaned = cleaned.slice(0, cleaned.length - cLower.length).trim()
  }
  const m = cleaned.match(/^(.+?)\s+(\d{4,5})\s+(.+)$/)
  if (m) {
    return { street: m[1].trim(), postcode: m[2], city: toTitleCase(m[3].trim()) }
  }
  return { street: cleaned, postcode: '', city: '' }
}

// ── Excel 解析核心（共用） ─────────────────────────────────────────

interface ExcelData {
  pallets: string; dimensions: string; loadingMeters: string; weight: string
  address1: string; address2: string; address3: string
}

function parseExcelFile(filePath: string): ExcelData {
  const workbook = XLSX.readFile(filePath)
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const getCellValue = (ref: string): string => {
    const cell = sheet[ref]
    if (!cell) return ''
    return String(cell.v ?? '').trim()
  }
  const rawAddress = getCellValue('D22')
  const rawAddress2 = getCellValue('D23')
  const country = getCellValue('D24')
  const parsed = parseFullAddressLine(rawAddress, country)
  const address1 = parsed.street || rawAddress
  const address2 = parsed.postcode ? `${parsed.postcode} ${parsed.city}`.trim() : rawAddress2
  return {
    pallets: getCellValue('D13'),
    dimensions: getCellValue('D14'),
    loadingMeters: getCellValue('D16'),
    weight: getCellValue('D17'),
    address1,
    address2,
    address3: country,
  }
}

// ── IPC: Excel ────────────────────────────────────────────────────

ipcMain.handle('open-and-parse-excel', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择 Excel 文件',
    filters: [{ name: 'Excel 文件', extensions: ['xlsx', 'xls'] }],
    properties: ['openFile']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  try {
    return parseExcelFile(result.filePaths[0])
  } catch {
    return null
  }
})

ipcMain.handle('parse-excel-file', (_event, filePath: string): ExcelData | null => {
  try {
    return parseExcelFile(filePath)
  } catch {
    return null
  }
})

ipcMain.handle('generate-inquiry-excel', async (_event, params: {
  record: NotionRecord
  destFolderPath: string | null
}): Promise<{ ok: boolean; filePath?: string; error?: string }> => {
  try {
    const { record, destFolderPath } = params
    const dims = record.dimensions
      ? record.dimensions.split(',').map((s: string) => s.trim()).filter(Boolean)
      : []

    const rows: (string | number | null)[][] = [
      ['Logistic Inquiry / 物流询价单'],
      [],
      ['日期 / Date',          record.date],
      ['类型 / Type',          record.type],
      ['目的国 / Country',     record.country],
      [],
      ['托盘数 / Pallets',     record.pallets ?? ''],
      ['重量 / Weight (kg)',   record.weight ?? ''],
      ['体积 / Volume (CBM)',  record.volume ?? ''],
      ['LDM',                  record.ldm ?? ''],
      [],
      ...dims.map((d: string, i: number) => [`尺寸 ${i + 1} / Dim ${i + 1}`, d] as (string | number | null)[]),
      ...(dims.length > 0 ? [[]] : []),
      ['地址 / Address',       record.address ?? ''],
      ['邮编 / Postal Code',   record.postalCode ?? ''],
      ['城市 / City',          record.city ?? ''],
      [],
      ['备注 / Remark',        record.remark ?? ''],
    ]

    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = [{ wch: 22 }, { wch: 40 }]
    XLSX.utils.book_append_sheet(wb, ws, 'Inquiry')

    const filename = `Inquiry_${record.date}_${record.type}_${record.country}.xlsx`

    let destPath: string | null = destFolderPath ? join(destFolderPath, filename) : null
    if (!destPath) {
      const r = await dialog.showSaveDialog({
        defaultPath: filename,
        filters: [{ name: 'Excel 文件', extensions: ['xlsx'] }],
      })
      if (r.canceled || !r.filePath) return { ok: false, error: '已取消' }
      destPath = r.filePath
    }

    const buf: Buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    writeFileSync(destPath, buf)
    return { ok: true, filePath: destPath }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

// ── IPC: Mail ─────────────────────────────────────────────────────

ipcMain.handle('open-url', (_event, url: string) => {
  shell.openExternal(url)
})

ipcMain.handle(
  'open-with-mail-app',
  (_event, appName: string, url: string): Promise<{ ok: boolean; message?: string }> => {
    if (!appName || process.platform !== 'darwin') {
      shell.openExternal(url)
      return Promise.resolve({ ok: true })
    }
    return new Promise((resolve) => {
      const child = spawn('open', ['-a', appName, url], { stdio: 'pipe' })
      let stderr = ''
      child.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
      child.on('error', (err) => {
        resolve({ ok: false, message: `无法启动 open 命令: ${err.message}` })
      })
      child.on('close', (code) => {
        if (code === 0) {
          resolve({ ok: true })
        } else {
          resolve({
            ok: false,
            message: `找不到 App「${appName}」(exit ${code})。${stderr.trim() ? ' ' + stderr.trim() : ''}`,
          })
        }
      })
    })
  }
)

ipcMain.handle('list-apps', (): string[] => {
  const { readdirSync, existsSync } = require('fs') as typeof import('fs')
  const dirs = ['/Applications', `${app.getPath('home')}/Applications`]
  const names: string[] = []
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    try {
      for (const entry of readdirSync(dir)) {
        if (entry.endsWith('.app')) names.push(entry.replace(/\.app$/, ''))
      }
    } catch { /* ignore */ }
  }
  return names.sort((a, b) => a.localeCompare(b))
})

ipcMain.handle('copy-to-clipboard', (_event, text: string) => {
  clipboard.writeText(text)
})

// ── IPC: Config ───────────────────────────────────────────────────

ipcMain.handle('read-app-config', () => {
  return readAppConfig(app.getPath('userData'))
})

ipcMain.handle('save-app-config', (_event, config) => {
  saveAppConfig(app.getPath('userData'), config)
  return { ok: true }
})

// ── IPC: Folder lifecycle ─────────────────────────────────────────

ipcMain.handle('create-archive-folder', (_event, params: {
  basePath: string
  date: string
  type: CargoType
  country: string
}) => {
  return createArchiveFolder(params.basePath, params.date, params.type, params.country)
})

ipcMain.handle('scan-folders', (_event, basePath: string) => {
  return scanFolders(basePath)
})

ipcMain.handle('rename-folder-append', (_event, params: {
  currentPath: string
  suffix: string
}) => {
  return renameFolderAppend(params.currentPath, params.suffix)
})

ipcMain.handle('move-files-to-folder', (_event, params: {
  srcPaths: string[]
  destFolderPath: string
}) => {
  return moveFilesToFolder(params.srcPaths, params.destFolderPath)
})

ipcMain.handle('read-folder-meta', (_event, folderPath: string) => {
  return readFolderMeta(folderPath)
})

ipcMain.handle('write-folder-meta', (_event, params: { folderPath: string; meta: unknown }) => {
  try {
    writeFolderMeta(params.folderPath, params.meta as Parameters<typeof writeFolderMeta>[1])
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

ipcMain.handle('find-folder-by-nr', (_event, params: {
  basePath: string
  angebotnummer: string
}) => {
  return findFolderByAngebotnummer(params.basePath, params.angebotnummer)
})

ipcMain.handle('open-folder-in-finder', (_event, folderPath: string) => {
  shell.openPath(folderPath)
})

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择档案根目录',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

ipcMain.handle('plan-folder-renames', (_event, basePath: string) => {
  return planFolderRenames(basePath)
})

ipcMain.handle('execute-folder-renames', (_event, renames) => {
  return executeFolderRenames(renames)
})

// ── IPC: PDF parsing ──────────────────────────────────────────────

ipcMain.handle('extract-angebotnummer', (_event, filename: string) => {
  return { angebotnummer: extractAngebotnummer(basename(filename)) }
})

ipcMain.handle('parse-rechnung-pdf', async (_event, filePath: string) => {
  return await extractRechnungData(filePath)
})

ipcMain.handle('copy-file-to-folders', (_event, params: {
  srcPath: string
  destFolderPaths: string[]
}) => {
  return copyFileToFolders(params.srcPath, params.destFolderPaths)
})

// ── IPC: Notion ───────────────────────────────────────────────────

ipcMain.handle('notion-test-connection', async (_event, notionConfig) => {
  return testConnection(notionConfig)
})

ipcMain.handle('notion-check-properties', async () => {
  const config = readAppConfig(app.getPath('userData'))
  if (!config.notion) return { ok: false, error: 'Notion 未配置' }
  try {
    return await checkDatabaseProperties(config.notion)
  } catch (e) {
    return { ok: false, error: String(e), missing: [], typeMismatch: [], extra: [] }
  }
})

// ── IPC: Notion — fetch (primary data source) ─────────────────────

ipcMain.handle('notion-fetch-records', async () => {
  const config = readAppConfig(app.getPath('userData'))
  if (!config.notion) return { ok: false, error: 'Notion 未配置', records: [] }
  try {
    const records = await fetchAllRecords(config.notion)
    return { ok: true, records }
  } catch (e) {
    return { ok: false, error: String(e), records: [] }
  }
})

ipcMain.handle('notion-fetch-record', async (_event, pageId: string) => {
  const config = readAppConfig(app.getPath('userData'))
  if (!config.notion) return { ok: false, error: 'Notion 未配置', record: null }
  try {
    const record = await fetchRecord(config.notion, pageId)
    return { ok: true, record }
  } catch (e) {
    return { ok: false, error: String(e), record: null }
  }
})

// ── IPC: Notion — create / update ────────────────────────────────

ipcMain.handle('notion-create-page', async (_event, params: {
  date: string
  type: CargoType
  country: string
  address?: string | null
  postalCode?: string | null
  city?: string | null
  pallets?: number | null
  weight?: number | null
  volume?: number | null
  ldm?: number | null
  folderPath?: string | null
  remark?: string | null
}) => {
  const config = readAppConfig(app.getPath('userData'))
  if (!config.notion) return { ok: false, error: 'Notion 未配置' }
  const result = await createPage(config.notion, { ...params, status: '待询价' })
  // 如果有本地文件夹，把 pageId 写入 .logianfrage.json
  if (result.ok && result.pageId && params.folderPath) {
    const meta = readFolderMeta(params.folderPath)
    if (meta) {
      writeFolderMeta(params.folderPath, { ...meta, notionPageId: result.pageId })
    }
  }
  return result
})

ipcMain.handle('notion-update-page', async (_event, params: UpdatePageParams & { pageId: string }) => {
  const config = readAppConfig(app.getPath('userData'))
  if (!config.notion) return { ok: false, error: 'Notion 未配置' }
  const { pageId, ...updateParams } = params
  return updatePage(config.notion, pageId, updateParams)
})

// ── IPC: PDF — Preisangebot & Speditionsauftrag ───────────────────

ipcMain.handle('parse-preisangebot-pdf', async (_event, filePath: string) => {
  return extractPreisangebotData(filePath)
})

ipcMain.handle('fill-speditionsauftrag', async (_event, params: {
  templatePath: string
  data: SpeditionsauftragData
  outputPath: string
}) => {
  return fillSpeditionsauftrag(params.templatePath, params.data, params.outputPath)
})

ipcMain.handle('fill-auftrag-from-pl', async (_event, params: {
  folderPath: string
  recordType: CargoType
}): Promise<{ ok: boolean; error?: string; outputFile?: string; outputPath?: string; warnings?: string[] }> => {
  const { folderPath, recordType } = params

  let files: string[]
  try { files = readdirSync(folderPath) }
  catch (e) { return { ok: false, error: `无法读取文件夹: ${e}` } }

  // Find PL file (starts with "PL" or contains "PackingList" / "Packing_List")
  const plFile = files.find(f => /^PL[-_]/i.test(f) && /\.pdf$/i.test(f))
    ?? files.find(f => /packing.?list/i.test(f) && /\.pdf$/i.test(f))
    ?? files.find(f => /^PL/i.test(f) && /\.pdf$/i.test(f))
  if (!plFile) return { ok: false, error: '文件夹中未找到 PL（Packing List）PDF 文件' }

  // Find unfilled Auftrag template (not starting with "[")
  const auftragFile = files.find(f =>
    /Speditionsauftrag/i.test(f) && /\.pdf$/i.test(f) && !f.startsWith('[')
  )
  if (!auftragFile) return { ok: false, error: '文件夹中未找到 Speditionsauftrag 模板文件（未填写版）' }

  const plPath = join(folderPath, plFile)
  const templatePath = join(folderPath, auftragFile)
  const outputPath = join(folderPath, `[*]${auftragFile}`)

  const plData = await parsePlPdf(plPath)
  if (!plData.company && !plData.street) {
    return { ok: false, error: `PL 解析失败：未能提取收货方信息（文件：${plFile}）` }
  }

  const result = await fillAuftragFromPl({ templatePath, plData, recordType, outputPath })
  if (!result.ok) return { ok: false, error: result.error }

  return {
    ok: true,
    outputFile: `[*]${auftragFile}`,
    outputPath,
    warnings: result.warnings ?? [],
  }
})

// ── 文件导入公共工具 ───────────────────────────────────────────────

export interface ImportResult {
  ok: boolean
  action?: string
  record?: { date: string; type: string; country: string; status: string; notionPageId: string }
  destPath?: string
  error?: string
}

function safeCopyFile(srcPath: string, destFolder: string): string {
  const destPath = join(destFolder, basename(srcPath))
  copyFileSync(srcPath, destPath)
  return destPath
}

function parseNumStr(s: string): number | null {
  const m = String(s).replace(/,/g, '').match(/\d+\.?\d*/)
  if (!m) return null
  const n = parseFloat(m[0])
  return isNaN(n) ? null : n
}

function todayFormatted(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '.')
}

function inferTypeFromExcel(filename: string, prodDesc: string): CargoType {
  const combined = `${filename} ${prodDesc}`.toUpperCase()
  if (/BATT(ERY)?/.test(combined) || /电池/.test(combined)) return 'BATT'
  if (/\bACC\b/.test(combined)) return 'ACC'
  return 'INV'
}

function editDist(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) => [i])
  for (let j = 1; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

// ── IPC: 询价文件（Excel）导入 ─────────────────────────────────────

ipcMain.handle('import-inquiry-excel', async (_event, filePath: string): Promise<ImportResult> => {
  const config = readAppConfig(app.getPath('userData'))
  if (!config.notion) return { ok: false, error: 'Notion 未配置' }

  let excelData: ExcelData
  try { excelData = parseExcelFile(filePath) }
  catch (e) { return { ok: false, error: `Excel 解析失败: ${e}` } }

  // D13 + D14 包含货物描述，用于辅助判断类型
  const workbook = XLSX.readFile(filePath)
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const d13 = sheet['D13'] ? String(sheet['D13'].v ?? '') : ''
  const d14 = sheet['D14'] ? String(sheet['D14'].v ?? '') : ''
  const prodDesc = `${d13} ${d14}`

  const type = inferTypeFromExcel(basename(filePath), prodDesc)
  const countryRaw = excelData.address3 || ''
  let country = normalizeCountry(countryRaw)
  if (!country) country = normalizeCountry(excelData.address2)
  if (!country) return { ok: false, error: `无法识别目的国（D24: "${countryRaw}"）` }

  const pallets = parseNumStr(excelData.pallets)
  const weight  = parseNumStr(excelData.weight)
  const ldm     = parseNumStr(excelData.loadingMeters)

  const records = await fetchAllRecords(config.notion)

  // 匹配：country + type 必须完全一致，pallets 精确匹配（均为 null 时也视为匹配）
  const candidates = records.filter(r =>
    r.country === country && r.type === type &&
    (r.status === '待询价' || r.status === '已询价')
  ).sort((a, b) => b.date.localeCompare(a.date))

  const match = candidates.find(r =>
    pallets === null || r.pallets === null || r.pallets === pallets
  )

  if (match) {
    // 重新询价：保存到已有文件夹
    let destPath: string | undefined
    if (match.folderPath && existsSync(match.folderPath)) {
      destPath = safeCopyFile(filePath, match.folderPath)
    }
    return {
      ok: true, action: '已关联已有询价',
      record: { date: match.date, type: match.type, country: match.country, status: match.status, notionPageId: match.notionPageId },
      destPath,
    }
  }

  // 新询价：建文件夹 + Notion 记录
  const today = todayFormatted()
  const folderResult = createArchiveFolder(config.basePath, today, type, country)
  if (!folderResult.ok || !folderResult.folderPath) {
    return { ok: false, error: `创建文件夹失败: ${folderResult.error}` }
  }
  const destPath = safeCopyFile(filePath, folderResult.folderPath)

  // 解析地址字段
  const postalMatch = (excelData.address2 || '').match(/^(\d{4,6})\s+(.+)$/)

  const notionResult = await createPage(config.notion, {
    date: today, type, country, status: '待询价',
    address: excelData.address1 || null,
    postalCode: postalMatch ? postalMatch[1] : null,
    city: postalMatch ? postalMatch[2] : null,
    pallets, weight, ldm,
    folderPath: folderResult.folderPath,
  })

  if (notionResult.ok && notionResult.pageId) {
    writeFolderMeta(folderResult.folderPath, {
      notionPageId: notionResult.pageId,
      angebotnummer: null, pickupNr: null, type, country, date: today,
    })
  }

  return {
    ok: notionResult.ok,
    action: '已创建新询价',
    record: notionResult.ok ? { date: today, type, country, status: '待询价', notionPageId: notionResult.pageId! } : undefined,
    destPath,
    error: notionResult.error,
  }
})

// ── IPC: Angebot PDF 导入 ─────────────────────────────────────────

ipcMain.handle('import-angebot-pdf', async (_event, filePath: string): Promise<ImportResult> => {
  const config = readAppConfig(app.getPath('userData'))
  if (!config.notion) return { ok: false, error: 'Notion 未配置' }

  const angebotnummer = extractAngebotnummer(basename(filePath))
  if (!angebotnummer) return { ok: false, error: '文件名中找不到 Angebotnummer（期望末尾为数字）' }

  // Parse PDF first so we can use gefahrgut + country for smarter fallback matching
  const pdfData = await extractPreisangebotData(filePath)

  const records = await fetchAllRecords(config.notion)

  // Primary: exact match by angebotnummer already stored in Notion
  let exactMatch = records.find(r => r.angebotnummer === angebotnummer)

  // Validate: if gefahrgut is known and conflicts with the matched record's type, the prior
  // assignment was wrong — discard the exact match and clear the bad record's angebotnummer
  let wrongRecord: typeof exactMatch | undefined
  if (exactMatch && pdfData.gefahrgut === false && exactMatch.type === 'BATT') {
    wrongRecord = exactMatch; exactMatch = undefined
  } else if (exactMatch && pdfData.gefahrgut === true && exactMatch.type !== 'BATT') {
    wrongRecord = exactMatch; exactMatch = undefined
  }

  let match = exactMatch

  if (!match) {
    // Fallback: most recent 已询价 record without angebotnummer, filtered by cargo type and country
    let candidates = records.filter(r => r.status === '已询价' && !r.angebotnummer)

    // Gefahrgut: Nein → non-BATT only; Ja → BATT only
    if (pdfData.gefahrgut === false) candidates = candidates.filter(r => r.type !== 'BATT')
    if (pdfData.gefahrgut === true)  candidates = candidates.filter(r => r.type === 'BATT')

    // Country match: prefer records whose country equals the destination country code in PDF
    if (pdfData.destCountryCode) {
      const countryFiltered = candidates.filter(r => r.country === pdfData.destCountryCode)
      if (countryFiltered.length > 0) candidates = countryFiltered
    }

    match = candidates.sort((a, b) => b.date.localeCompare(a.date))[0]
  }
  if (!match) return { ok: false, error: `找不到对应询价记录（Angebot Nr: ${angebotnummer}，Gefahrgut: ${pdfData.gefahrgut === true ? 'Ja' : pdfData.gefahrgut === false ? 'Nein' : '未知'}）` }

  // Clear angebotnummer from the wrongly-tagged record before updating the correct one
  if (wrongRecord) {
    await updatePage(config.notion, wrongRecord.notionPageId, { angebotnummer: '' })
  }

  // 确保文件夹存在
  let folderPath = match.folderPath
  if (!folderPath || !existsSync(folderPath)) {
    const fr = createArchiveFolder(config.basePath, match.date, match.type as CargoType, match.country)
    if (!fr.ok || !fr.folderPath) return { ok: false, error: `创建文件夹失败: ${fr.error}` }
    folderPath = fr.folderPath
  }

  const destPath = safeCopyFile(filePath, folderPath)

  // 更新 Notion
  const updateResult = await updatePage(config.notion, match.notionPageId, {
    angebotnummer,
    ...(pdfData.amount !== null ? { amount: pdfData.amount } : {}),
    status: '已报价',
    folderPath,
  })

  if (!updateResult.ok) {
    return {
      ok: false,
      error: `文件已保存，但 Notion 更新失败：${updateResult.error ?? '未知错误'}`,
      destPath,
    }
  }

  return {
    ok: true,
    action: `已更新为已报价${pdfData.amount !== null ? `（报价 €${pdfData.amount}）` : '（未提取到金额）'}`,
    record: { date: match.date, type: match.type, country: match.country, status: '已报价', notionPageId: match.notionPageId },
    destPath,
  }
})

// ── IPC: Angebot PDF 匹配预览 + 确认 ──────────────────────────────

interface AngebotMatchDetail {
  country: boolean | null
  typeOk:  boolean | null
  zip:     boolean | null
  pallets: boolean | null
  weight:  boolean | null
  volume:  boolean | null
}

interface AngebotCandidateResult {
  notionPageId: string
  date: string
  type: string
  country: string
  postalCode: string | null
  city: string | null
  pallets: number | null
  weight: number | null
  volume: number | null
  status: string
  angebotnummer: string | null
  score: number
  matchDetails: AngebotMatchDetail
}

function scoreAngebotRecord(record: NotionRecord, pdf: PreisangebotData): { score: number; matchDetails: AngebotMatchDetail } {
  let score = 0
  const md: AngebotMatchDetail = { country: null, typeOk: null, zip: null, pallets: null, weight: null, volume: null }

  if (pdf.destCountryCode) {
    md.country = record.country === pdf.destCountryCode
    if (md.country) score += 4
  }

  if (pdf.gefahrgut !== null) {
    md.typeOk = pdf.gefahrgut === (record.type === 'BATT')
    if (md.typeOk) score += 4; else score -= 10
  }

  if (pdf.destZip && record.postalCode) {
    md.zip = record.postalCode === pdf.destZip
    if (md.zip) score += 5
  }

  if (pdf.pallets !== null && record.pallets !== null) {
    md.pallets = pdf.pallets === record.pallets
    if (md.pallets) score += 3
  }

  if (pdf.weight !== null && record.weight !== null) {
    const r = Math.abs(pdf.weight - record.weight) / Math.max(pdf.weight, record.weight, 1)
    md.weight = r <= 0.15
    if (md.weight) score += 2
  }

  if (pdf.volume !== null && record.volume !== null) {
    const r = Math.abs(pdf.volume - record.volume) / Math.max(pdf.volume, record.volume, 1)
    md.volume = r <= 0.15
    if (md.volume) score += 1
  }

  return { score, matchDetails: md }
}

ipcMain.handle('preview-angebot-match', async (_event, filePath: string): Promise<{
  ok: boolean; error?: string
  pdfData: PreisangebotData
  candidates: AngebotCandidateResult[]
}> => {
  const config = readAppConfig(app.getPath('userData'))
  if (!config.notion) return { ok: false, error: 'Notion 未配置', pdfData: {} as PreisangebotData, candidates: [] }

  let pdfData: PreisangebotData
  try { pdfData = await extractPreisangebotData(filePath) }
  catch (e) { return { ok: false, error: `PDF 解析失败: ${e}`, pdfData: {} as PreisangebotData, candidates: [] } }

  const records = await fetchAllRecords(config.notion)
  const candidates: AngebotCandidateResult[] = records
    .map(r => {
      const { score, matchDetails } = scoreAngebotRecord(r, pdfData)
      return {
        notionPageId: r.notionPageId, date: r.date, type: r.type, country: r.country,
        postalCode: r.postalCode, city: r.city, pallets: r.pallets, weight: r.weight,
        volume: r.volume, status: r.status, angebotnummer: r.angebotnummer,
        score, matchDetails,
      }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)

  return { ok: true, pdfData, candidates }
})

ipcMain.handle('confirm-angebot-import', async (_event, params: {
  filePath: string; notionPageId: string; pdfData: PreisangebotData
}): Promise<ImportResult> => {
  const config = readAppConfig(app.getPath('userData'))
  if (!config.notion) return { ok: false, error: 'Notion 未配置' }

  const { filePath, notionPageId, pdfData } = params
  const angebotnummer = extractAngebotnummer(basename(filePath))

  const record = await fetchRecord(config.notion, notionPageId)
  if (!record) return { ok: false, error: '找不到对应 Notion 记录' }

  let folderPath = record.folderPath
  if (!folderPath || !existsSync(folderPath)) {
    const fr = createArchiveFolder(config.basePath, record.date, record.type as CargoType, record.country)
    if (!fr.ok || !fr.folderPath) return { ok: false, error: `创建文件夹失败: ${fr.error}` }
    folderPath = fr.folderPath
  }

  const destPath = safeCopyFile(filePath, folderPath)

  const updateResult = await updatePage(config.notion, notionPageId, {
    ...(angebotnummer ? { angebotnummer } : {}),
    ...(pdfData.amount !== null ? { amount: pdfData.amount } : {}),
    status: '已报价',
    folderPath,
  })

  if (!updateResult.ok) {
    return { ok: false, error: `文件已保存，但 Notion 更新失败：${updateResult.error ?? '未知错误'}`, destPath }
  }

  return {
    ok: true,
    action: `已更新为已报价${pdfData.amount !== null ? `（报价 €${pdfData.amount}）` : '（未提取到金额）'}`,
    record: { date: record.date, type: record.type, country: record.country, status: '已报价', notionPageId },
    destPath,
  }
})

// ── IPC: Auftrag PDF 导入 ─────────────────────────────────────────

ipcMain.handle('import-auftrag-pdf', async (_event, filePath: string): Promise<ImportResult> => {
  const config = readAppConfig(app.getPath('userData'))
  if (!config.notion) return { ok: false, error: 'Notion 未配置' }

  // Auftrag filename may embed the Preisangebot filename, e.g. "Speditionsauftrag_003_15826566.pdf"
  // Try every numeric sequence (≥5 digits) in the filename against stored angebotnummer values
  const fileBase = basename(filePath, '.pdf').replace(/\.[pP][dD][fF]$/, '')
  const numCandidates = [...fileBase.matchAll(/\d{5,}/g)].map(m => m[0])
  if (numCandidates.length === 0) return { ok: false, error: '文件名中找不到 Angebotnummer（需要5位以上数字）' }

  const records = await fetchAllRecords(config.notion)
  // Match the first candidate that exists in Notion
  let match = numCandidates
    .map(nr => records.find(r => r.angebotnummer === nr))
    .find(Boolean)
  const angebotnummer = numCandidates.find(nr => records.some(r => r.angebotnummer === nr))
    ?? numCandidates[numCandidates.length - 1]   // fallback: last (longest usually) number in name
  if (!match) return { ok: false, error: `找不到对应记录（文件名中数字：${numCandidates.join(', ')}）` }

  let folderPath = match.folderPath
  if (!folderPath || !existsSync(folderPath)) {
    const fr = createArchiveFolder(config.basePath, match.date, match.type as CargoType, match.country)
    if (!fr.ok || !fr.folderPath) return { ok: false, error: `创建文件夹失败: ${fr.error}` }
    folderPath = fr.folderPath
  }

  const destPath = safeCopyFile(filePath, folderPath)

  // 如果是填写好的 Auftrag（文件名以 (r) 开头），状态改为已填表
  const isFilled = /^\(r\)speditionsauftrag/i.test(basename(filePath))
  if (isFilled && match.status === '已报价') {
    await updatePage(config.notion, match.notionPageId, { status: '已要求出货', folderPath })
  }

  return {
    ok: true, action: isFilled ? '已更新为已要求出货' : '文件已保存',
    record: { date: match.date, type: match.type, country: match.country,
              status: isFilled ? '已要求出货' : match.status, notionPageId: match.notionPageId },
    destPath,
  }
})

// ── IPC: Invoice / Rechnung PDF 导入 ─────────────────────────────

ipcMain.handle('import-invoice-pdf', async (_event, filePath: string): Promise<ImportResult> => {
  const config = readAppConfig(app.getPath('userData'))
  if (!config.notion) return { ok: false, error: 'Notion 未配置' }

  const rechnungData = await extractRechnungData(filePath)

  // 先从 PDF 内容里的 Tagespreis-Nr/Auf-Nr 找，再从文件名找
  const angebotnummer = rechnungData.tagespreisNr ?? extractAngebotnummer(basename(filePath))
  if (!angebotnummer) return { ok: false, error: '无法从文件名或 PDF 内容提取 Angebotnummer' }

  const records = await fetchAllRecords(config.notion)
  let match = records.find(r => r.angebotnummer === angebotnummer)
  if (!match) {
    // Fuzzy fallback: edit distance ≤ 1 (handles OCR/typo off-by-one digit)
    const scored = records
      .filter(r => r.angebotnummer && Math.abs(r.angebotnummer.length - angebotnummer.length) <= 2)
      .map(r => ({ r, d: editDist(r.angebotnummer!, angebotnummer) }))
      .filter(x => x.d <= 1)
      .sort((a, b) => a.d - b.d)
    match = scored[0]?.r
  }
  if (!match) return { ok: false, error: `找不到 Angebotnummer ${angebotnummer} 的记录` }

  let folderPath = match.folderPath
  if (!folderPath || !existsSync(folderPath)) {
    const fr = createArchiveFolder(config.basePath, match.date, match.type as CargoType, match.country)
    if (!fr.ok || !fr.folderPath) return { ok: false, error: `创建文件夹失败: ${fr.error}` }
    folderPath = fr.folderPath
  }

  const destPath = safeCopyFile(filePath, folderPath)

  const amount = rechnungData.bruttoAmount ? parseNumStr(rechnungData.bruttoAmount) : null
  await updatePage(config.notion, match.notionPageId, {
    ...(amount !== null ? { rechnungAmount: amount } : {}),
    status: '已收账单',
    folderPath,
  })

  return {
    ok: true, action: `已收账单${amount ? `（€${rechnungData.bruttoAmount}）` : ''}`,
    record: { date: match.date, type: match.type, country: match.country, status: '已收账单', notionPageId: match.notionPageId },
    destPath,
  }
})

// ── IPC: Rechnung PDF 匹配预览 + 确认 ────────────────────────────

interface RechnungPositionCandidate {
  notionPageId: string
  date: string
  type: string
  country: string
  status: string
  angebotnummer: string | null
  rswCode: string | null
  score: number
  matchLabel: string | null
}

interface RechnungPreviewPosition {
  positionIndex: number
  aufNr: string | null
  tagespreisNr: string | null
  rswCode: string | null
  nettoAmount: number | null
  candidates: RechnungPositionCandidate[]
}

function scoreRechnungPosition(
  record: NotionRecord,
  pos: { aufNr: string | null; tagespreisNr: string | null; rswCode: string | null },
): { score: number; matchLabel: string | null } {
  // Auf-Nr exact (DACHSER SUMMENRECHNUNG primary key)
  if (pos.aufNr && record.angebotnummer) {
    if (record.angebotnummer === pos.aufNr)
      return { score: 20, matchLabel: 'Auf-Nr 精确' }
    if (editDist(record.angebotnummer, pos.aufNr) <= 1)
      return { score: 12, matchLabel: 'Auf-Nr 近似' }
  }
  // Tagespreis-Nr. exact / fuzzy (fallback for other invoice formats)
  if (pos.tagespreisNr && record.angebotnummer) {
    if (record.angebotnummer === pos.tagespreisNr)
      return { score: 18, matchLabel: 'Tagespreis-Nr 精确' }
    if (editDist(record.angebotnummer, pos.tagespreisNr) <= 1)
      return { score: 10, matchLabel: 'Tagespreis-Nr 近似' }
  }
  // RSW code exact / prefix
  if (pos.rswCode && record.rswCode) {
    if (record.rswCode === pos.rswCode)
      return { score: 15, matchLabel: 'RSW 精确' }
    const prefix = pos.rswCode.split('-')[0]
    if (record.rswCode.startsWith(prefix))
      return { score: 8, matchLabel: 'RSW 前缀' }
  }
  return { score: 0, matchLabel: null }
}

ipcMain.handle('preview-rechnung-match', async (_event, filePath: string): Promise<{
  ok: boolean; error?: string
  invoiceNr: string | null
  nettoTotal: number | null
  bruttoTotal: number | null
  positions: RechnungPreviewPosition[]
}> => {
  const config = readAppConfig(app.getPath('userData'))
  const noConfig = { ok: false, error: 'Notion 未配置', invoiceNr: null, nettoTotal: null, bruttoTotal: null, positions: [] }
  if (!config.notion) return noConfig

  let rechnungData: RechnungData
  try { rechnungData = await extractRechnungData(filePath) }
  catch (e) { return { ...noConfig, ok: false, error: `PDF 解析失败: ${e}` } }

  const records = await fetchAllRecords(config.notion)
  const invoiceNr = extractAngebotnummer(basename(filePath))

  const positions: RechnungPreviewPosition[] = rechnungData.positions.map((pos, idx) => {
    const candidates: RechnungPositionCandidate[] = records
      .map(r => {
        const { score, matchLabel } = scoreRechnungPosition(r, pos)
        return { notionPageId: r.notionPageId, date: r.date, type: r.type, country: r.country,
                 status: r.status, angebotnummer: r.angebotnummer, rswCode: r.rswCode, score, matchLabel }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
    return { positionIndex: idx, aufNr: pos.aufNr, tagespreisNr: pos.tagespreisNr, rswCode: pos.rswCode,
             nettoAmount: pos.nettoAmount, candidates }
  })

  return { ok: true, invoiceNr, nettoTotal: rechnungData.nettoTotal, bruttoTotal: rechnungData.bruttoTotal, positions }
})

ipcMain.handle('confirm-rechnung-import', async (_event, params: {
  filePath: string
  bruttoTotal: number | null
  nettoTotal: number | null
  invoiceNr: string | null
  matches: Array<{ positionIndex: number; notionPageId: string; nettoAmount: number | null }>
}): Promise<{ ok: boolean; results: Array<{ ok: boolean; notionPageId: string; error?: string }> }> => {
  const config = readAppConfig(app.getPath('userData'))
  if (!config.notion) return { ok: false, results: [] }

  const { filePath, bruttoTotal, nettoTotal, invoiceNr, matches } = params
  const results: Array<{ ok: boolean; notionPageId: string; error?: string }> = []
  const isSingle = matches.length === 1

  for (const m of matches) {
    const record = await fetchRecord(config.notion, m.notionPageId)
    if (!record) { results.push({ ok: false, notionPageId: m.notionPageId, error: '找不到 Notion 记录' }); continue }

    let folderPath = record.folderPath
    if (!folderPath || !existsSync(folderPath)) {
      const fr = createArchiveFolder(config.basePath, record.date, record.type as CargoType, record.country)
      if (!fr.ok || !fr.folderPath) { results.push({ ok: false, notionPageId: m.notionPageId, error: `创建文件夹失败: ${fr.error}` }); continue }
      folderPath = fr.folderPath
    }

    safeCopyFile(filePath, folderPath)

    // Brutto: for single-position use invoice total; for multi split proportionally
    let bruttoPos: number | null = null
    if (isSingle) {
      bruttoPos = bruttoTotal
    } else if (m.nettoAmount !== null && nettoTotal !== null && nettoTotal > 0 && bruttoTotal !== null) {
      bruttoPos = Math.round((m.nettoAmount / nettoTotal) * bruttoTotal * 100) / 100
    }

    const upd = await updatePage(config.notion, m.notionPageId, {
      ...(m.nettoAmount !== null ? { rechnungAmount: m.nettoAmount } : {}),
      ...(bruttoPos !== null ? { rechnungAmountBrutto: bruttoPos } : {}),
      ...(invoiceNr ? { invoiceNr } : {}),
      status: '已收账单',
      folderPath,
    })
    results.push({ ok: upd.ok, notionPageId: m.notionPageId, error: upd.error })
  }

  return { ok: results.every(r => r.ok), results }
})

// ── IPC: Email ────────────────────────────────────────────────────────────────

ipcMain.handle('email-test-smtp', async (_e, config: EmailConfig) => {
  try { await testSmtp(config); return { ok: true } }
  catch (e) { return { ok: false, error: String(e) } }
})

ipcMain.handle('email-test-imap', async (_e, config: EmailConfig) => {
  try { await testImap(config); return { ok: true } }
  catch (e) { return { ok: false, error: String(e) } }
})

ipcMain.handle('email-send', async (_e, config: EmailConfig, opts: SendEmailOptions) => {
  try { await sendEmail(config, opts); return { ok: true } }
  catch (e) { return { ok: false, error: String(e) } }
})

// Send using the saved email config from userData (no need to pass config from renderer)
ipcMain.handle('email-send-saved', async (_e, opts: SendEmailOptions) => {
  const config = readAppConfig(app.getPath('userData'))
  if (!config.email) return { ok: false, error: '邮件未配置' }
  try { await sendEmail(config.email, opts); return { ok: true } }
  catch (e) { return { ok: false, error: String(e) } }
})

ipcMain.handle('email-list-folders', async (_e, config: EmailConfig) => {
  try {
    const folders = await listMailboxFolders(config)
    return { ok: true, folders }
  } catch (e) { return { ok: false, folders: [], error: String(e) } }
})

ipcMain.handle('email-fetch-dachser', async (_e, config: EmailConfig) => {
  try {
    const result = await fetchDachserEmailsIncremental(config, app.getPath('userData'))
    return { ok: true, messages: result.messages, savedAt: result.savedAt }
  } catch (e) { return { ok: false, messages: [], error: String(e) } }
})

ipcMain.handle('email-get-cache', () => {
  const cache = loadEmailCache(app.getPath('userData'))
  return { messages: cache.messages, savedAt: cache.savedAt }
})

ipcMain.handle('email-clear-cache', () => {
  clearEmailCache(app.getPath('userData'))
  return { ok: true }
})

ipcMain.handle('email-fetch-inbox', async (_e, config: EmailConfig, folder?: string) => {
  try {
    const messages = await fetchInbox(config, 80, folder ?? 'INBOX')
    return { ok: true, messages }
  } catch (e) { return { ok: false, messages: [], error: String(e) } }
})

ipcMain.handle('email-fetch-detail', async (_e, config: EmailConfig, uid: number, folder?: string) => {
  try {
    const detail = await fetchMessageDetail(config, uid, folder ?? 'INBOX')
    return { ok: true, detail }
  } catch (e) { return { ok: false, error: String(e) } }
})

ipcMain.handle('email-save-attachment', async (_e, config: EmailConfig, uid: number, attachmentIndex: number, folder?: string) => {
  try {
    const result = await saveAttachmentToTemp(config, uid, attachmentIndex, folder ?? 'INBOX')
    return { ok: true, ...result }
  } catch (e) { return { ok: false, error: String(e) } }
})
