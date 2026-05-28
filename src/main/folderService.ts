import { existsSync, mkdirSync, readdirSync, renameSync, copyFileSync, unlinkSync, readFileSync, writeFileSync } from 'fs'
import { join, basename } from 'path'
import type { CargoType, FolderMeta, ArchiveRecord } from '../renderer/utils/types'

const ROMAN_NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']
const META_FILENAME = '.logianfrage.json'

// ── 货物类型 & 辅助正则 ───────────────────────────────────────────

const TYPE_RE    = /^(INV|BATT?|ACC)$/i   // BATT? 兼容 "BAT"
const ROMAN_RE   = /^(I{1,3}|IV|V|VI{0,3}|IX|X)$/i
const NUMERIC_RE = /^\d{5,}$/              // Angebotnummer ≥5 位纯数字
const PICKUP_RE  = /^RSW\d+-[A-Z]$/i      // RSW324-A / RSW348-V

function isPickup(s: string): boolean {
  return PICKUP_RE.test(s)
}

function normalizeType(raw: string): CargoType {
  const u = raw.toUpperCase()
  if (u === 'BAT') return 'BATT'
  if (u === 'BATT' || u === 'INV' || u === 'ACC') return u as CargoType
  return 'INV'
}

// ── 国家代码标准化 ────────────────────────────────────────────────

const COUNTRY_MAP: Record<string, string> = {
  // 全称（小写 key）
  'italy': 'IT', 'france': 'FR', 'germany': 'DE', 'poland': 'PL',
  'romania': 'RO', 'croatia': 'HR', 'hungary': 'HU', 'moldova': 'MD',
  'austria': 'AT', 'spain': 'ES', 'switzerland': 'CH', 'netherlands': 'NL',
  'belgium': 'BE', 'czech': 'CZ', 'czechia': 'CZ', 'slovakia': 'SK',
  'bulgaria': 'BG', 'serbia': 'RS', 'turkey': 'TR', 'portugal': 'PT',
  'sweden': 'SE', 'norway': 'NO', 'denmark': 'DK', 'finland': 'FI',
  'ukraine': 'UA', 'greece': 'GR', 'armenia': 'AM', 'slovenia': 'SI',
  'albania': 'AL', 'latvia': 'LV', 'lithuania': 'LT', 'estonia': 'EE',
  // 3 字母缩写
  'pol': 'PL', 'hun': 'HU', 'rom': 'RO', 'cze': 'CZ', 'svk': 'SK',
  'deu': 'DE', 'fra': 'FR', 'aut': 'AT', 'esp': 'ES', 'os': 'AT',
  'fin': 'FI', 'ita': 'IT', 'nor': 'NO', 'swe': 'SE', 'dnk': 'DK',
  'nld': 'NL', 'bel': 'BE', 'che': 'CH', 'prt': 'PT', 'grc': 'GR',
  'hrv': 'HR', 'tur': 'TR', 'ukr': 'UA', 'srb': 'RS', 'bgr': 'BG',
  'svn': 'SI', 'alb': 'AL', 'lva': 'LV', 'ltu': 'LT', 'est': 'EE',
  // 中文名
  '意大利': 'IT', '法国': 'FR', '德国': 'DE', '波兰': 'PL',
  '罗马尼亚': 'RO', '克罗地亚': 'HR', '匈牙利': 'HU', '摩尔多瓦': 'MD',
  '奥地利': 'AT', '西班牙': 'ES', '捷克': 'CZ', '斯洛伐克': 'SK',
  '亚美尼亚': 'AM', '保加利亚': 'BG', '塞尔维亚': 'RS', '斯洛文尼亚': 'SI',
  '荷兰': 'NL', '比利时': 'BE', '乌克兰': 'UA', '希腊': 'GR',
  '土耳其': 'TR', '葡萄牙': 'PT', '英国': 'GB',
}

export function normalizeCountry(raw: string): string {
  if (!raw) return ''
  if (/^[A-Z]{2}$/.test(raw)) return raw              // 已是 2 字母大写
  const mapped = COUNTRY_MAP[raw.toLowerCase()] ?? COUNTRY_MAP[raw]
  if (mapped) return mapped
  if (/^[A-Z]{3,}$/i.test(raw)) {                     // 3+ 字母缩写
    const u = raw.toUpperCase()
    const map3: Record<string, string> = {
      'POL': 'PL', 'HUN': 'HU', 'ROM': 'RO', 'CZE': 'CZ', 'SVK': 'SK',
      'FIN': 'FI', 'ITA': 'IT', 'DEU': 'DE', 'FRA': 'FR', 'NOR': 'NO',
      'SWE': 'SE', 'DNK': 'DK', 'NLD': 'NL', 'BEL': 'BE', 'CHE': 'CH',
      'PRT': 'PT', 'ESP': 'ES', 'AUT': 'AT', 'GRC': 'GR', 'HRV': 'HR',
      'TUR': 'TR', 'UKR': 'UA', 'SRB': 'RS', 'BGR': 'BG', 'SVN': 'SI',
      'ALB': 'AL', 'LVA': 'LV', 'LTU': 'LT', 'EST': 'EE',
    }
    return map3[u] ?? ''
  }
  return ''
}

// ── 纯函数 ────────────────────────────────────────────────────────

/**
 * 标准文件夹名格式（2026+）：DD CC TYPE [Roman] [Angebot] [Pickup]
 * 文件夹位于 /YYYY/YYYY.MM/ 下，日期通过目录上下文推断。
 */
export function buildFolderName(
  date: string,  // YYYY.MM.DD
  type: CargoType,
  country: string,
  roman: string,
  angebotnummer?: string | null,
  pickupNr?: string | null,
): string {
  const dd = date.slice(8, 10)  // extract DD
  const parts = [dd, country, type]
  if (roman) parts.push(roman)
  if (angebotnummer) parts.push(angebotnummer)
  if (pickupNr) parts.push(pickupNr)
  return parts.join(' ')
}

export function nextRomanNumeral(
  monthDir: string,
  date: string,
  type: CargoType,
  country: string,
): string {
  let entries: string[] = []
  try { entries = readdirSync(monthDir) } catch { /* ignore */ }
  // 新格式前缀：DD CC TYPE
  const dd = date.slice(8, 10)
  const prefix = `${dd} ${country} ${type}`
  const count = entries.filter((e) => e.startsWith(prefix)).length
  return ROMAN_NUMERALS[count] ?? `(${count + 1})`
}

export function stripLeadingZeros(s: string): string {
  return s.replace(/^0+/, '') || '0'
}

// ── 文件夹元数据读写 ──────────────────────────────────────────────

export function readFolderMeta(folderPath: string): FolderMeta | null {
  const metaPath = join(folderPath, META_FILENAME)
  try {
    const raw = readFileSync(metaPath, 'utf-8')
    return JSON.parse(raw) as FolderMeta
  } catch {
    return null
  }
}

export function writeFolderMeta(folderPath: string, meta: FolderMeta): void {
  const metaPath = join(folderPath, META_FILENAME)
  writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
}

// ── 文件夹操作 ────────────────────────────────────────────────────

export interface CreateFolderResult {
  ok: boolean
  folderPath?: string
  folderName?: string
  error?: string
}

export function createArchiveFolder(
  basePath: string,
  date: string,    // YYYY.MM.DD
  type: CargoType,
  country: string,
): CreateFolderResult {
  try {
    const yyyy   = date.slice(0, 4)  // "YYYY"
    const yyyyMM = date.slice(0, 7)  // "YYYY.MM"
    const monthDir = join(basePath, yyyy, yyyyMM)
    if (!existsSync(monthDir)) mkdirSync(monthDir, { recursive: true })

    const roman = nextRomanNumeral(monthDir, date, type, country)
    const folderName = buildFolderName(date, type, country, roman, null, null)
    const folderPath = join(monthDir, folderName)
    mkdirSync(folderPath)

    const meta: FolderMeta = {
      notionPageId: null, angebotnummer: null, pickupNr: null, type, country, date,
    }
    writeFolderMeta(folderPath, meta)
    return { ok: true, folderPath, folderName }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export interface RenameResult {
  ok: boolean
  newPath?: string
  error?: string
}

export function renameFolderAppend(
  currentPath: string,
  suffix: string,
): RenameResult {
  try {
    const parent = join(currentPath, '..')
    const name = basename(currentPath)
    const newName = `${name} ${suffix}`
    const newPath = join(parent, newName)
    renameSync(currentPath, newPath)
    return { ok: true, newPath }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export interface MoveFilesResult {
  ok: boolean
  movedFiles?: string[]
  error?: string
}

export function moveFilesToFolder(
  srcPaths: string[],
  destFolderPath: string,
): MoveFilesResult {
  const moved: string[] = []
  try {
    for (const src of srcPaths) {
      const destPath = join(destFolderPath, basename(src))
      copyFileSync(src, destPath)
      unlinkSync(src)
      moved.push(basename(src))
    }
    return { ok: true, movedFiles: moved }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export function copyFileToFolders(
  srcPath: string,
  destFolderPaths: string[],
): { ok: boolean; error?: string } {
  try {
    for (const dest of destFolderPaths) {
      copyFileSync(srcPath, join(dest, basename(srcPath)))
    }
    unlinkSync(srcPath)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

// ── 扫描（递归，支持新旧两种文件夹名格式）───────────────────────

const NEW_FOLDER_RE = /^\d{2} [A-Z]{2} (INV|BATT|ACC)/i  // 新格式：DD CC TYPE
const YYYY_MM_RE    = /^\d{4}\.\d{2}$/                     // YYYY.MM 月目录

/** 递归收集档案文件夹，同时记录 YYYY.MM 上下文（新格式需要）*/
function collectArchiveFolders(
  dirPath: string,
  depth: number,
  out: Array<{ path: string; name: string; yyyyMM?: string }>,
): void {
  if (depth > 4) return
  let entries: import('fs').Dirent[]
  try {
    entries = readdirSync(dirPath, { withFileTypes: true }) as import('fs').Dirent[]
  } catch {
    return
  }
  const parentName = basename(dirPath)
  const isMonthDir = YYYY_MM_RE.test(parentName)

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const fullPath = join(dirPath, entry.name)
    if (/^\d{4}\.\d{2}\.\d{2}/.test(entry.name)) {
      // 旧格式：完整日期在文件夹名中
      out.push({ path: fullPath, name: entry.name })
    } else if (NEW_FOLDER_RE.test(entry.name) && isMonthDir) {
      // 新格式：位于 YYYY.MM 目录下，以 DD CC TYPE 开头
      out.push({ path: fullPath, name: entry.name, yyyyMM: parentName })
    } else {
      collectArchiveFolders(fullPath, depth + 1, out)
    }
  }
}

/** 从文件夹名解析各字段（兼容新旧格式，容错）*/
function parseFolderName(name: string, yyyyMM?: string): {
  date: string
  type: CargoType
  country: string
  romanNumeral: string
  angebotnummer: string | null
  pickupNr: string | null
} {
  const parts = name.split(' ')
  let date: string
  let startIdx: number

  if (/^\d{4}\.\d{2}\.\d{2}/.test(parts[0])) {
    // 旧格式：YYYY.MM.DD TYPE CC [Roman]
    date = parts[0]
    startIdx = 1
  } else if (/^\d{2}$/.test(parts[0]) && yyyyMM) {
    // 新格式：DD CC TYPE [Roman]，在 YYYY.MM 目录下
    date = `${yyyyMM}.${parts[0]}`
    startIdx = 1
  } else {
    date = ''
    startIdx = 0
  }

  let type: CargoType = 'INV'
  let country = ''
  let romanNumeral = ''
  let angebotnummer: string | null = null
  let pickupNr: string | null = null

  const typeIdx   = parts.findIndex((p, i) => i >= startIdx && TYPE_RE.test(p))
  const romanIdx  = parts.findIndex((p, i) => i >= startIdx && ROMAN_RE.test(p))
  const angIdx    = parts.findIndex((p, i) => i >= startIdx && NUMERIC_RE.test(p))
  const pickupIdx = parts.findIndex((p, i) => i >= startIdx && isPickup(p))

  if (typeIdx >= startIdx)   type          = normalizeType(parts[typeIdx])
  if (romanIdx >= startIdx)  romanNumeral  = parts[romanIdx]
  if (angIdx >= startIdx)    angebotnummer = parts[angIdx]
  if (pickupIdx >= startIdx) pickupNr      = parts[pickupIdx]

  // 国家：startIdx 之后第一个不属于已知类别的 token
  const used = new Set([typeIdx, romanIdx, angIdx, pickupIdx].filter(i => i >= startIdx))
  for (let i = startIdx; i < parts.length; i++) {
    if (used.has(i)) continue
    const p = parts[i]
    if (TYPE_RE.test(p) || ROMAN_RE.test(p) || NUMERIC_RE.test(p) || isPickup(p)) continue
    country = p
    break
  }

  return { date, type, country, romanNumeral, angebotnummer, pickupNr }
}

export function scanFolders(basePath: string): ArchiveRecord[] {
  if (!existsSync(basePath)) return []

  const raw: Array<{ path: string; name: string; yyyyMM?: string }> = []
  collectArchiveFolders(basePath, 0, raw)
  // 按完整路径降序排列（路径包含 YYYY/YYYY.MM，可保证时间顺序）
  raw.sort((a, b) => b.path.localeCompare(a.path))

  const records: ArchiveRecord[] = []
  for (const { path: folderPath, name, yyyyMM } of raw) {
    const meta = readFolderMeta(folderPath)
    const parsed = parseFolderName(name, yyyyMM)

    let files: string[] = []
    try {
      const isHidden = (f: string) => f === META_FILENAME || f.startsWith('~$') || f.startsWith('._')
      const topEntries = readdirSync(folderPath, { withFileTypes: true }) as import('fs').Dirent[]
      for (const ent of topEntries) {
        if (isHidden(ent.name)) continue
        if (ent.isDirectory()) {
          // Include files one level deep (e.g. "3 单" folders with per-order sub-folders)
          try {
            const subFiles = readdirSync(join(folderPath, ent.name))
              .filter(f => !isHidden(f))
              .map(f => `${ent.name}/${f}`)
            files.push(...subFiles)
          } catch { /* ignore */ }
        } else {
          files.push(ent.name)
        }
      }
    } catch { /* ignore */ }

    // Auto-extract Angebotnr from DACHSER_Preisangebot filename if not already known
    let autoAngebotnr: string | null = null
    const preisangFile = files.find(
      (f) => /DACHSER_Preisangebot/i.test(f) && /\.pdf$/i.test(f),
    )
    if (preisangFile) {
      const m = preisangFile.match(/(\d+)\.pdf$/i)
      if (m) autoAngebotnr = m[1]
    }

    const resolvedAngebotnr = meta?.angebotnummer ?? parsed.angebotnummer ?? autoAngebotnr

    // Persist auto-detected Angebotnr into meta so it's available for Notion sync
    if (autoAngebotnr && meta && !meta.angebotnummer) {
      try { writeFolderMeta(folderPath, { ...meta, angebotnummer: autoAngebotnr }) } catch { /* ignore */ }
    }

    records.push({
      folderPath,
      folderName: name,
      date: parsed.date,
      type: parsed.type,
      country: parsed.country,
      romanNumeral: parsed.romanNumeral,
      angebotnummer: resolvedAngebotnr,
      pickupNr:      meta?.pickupNr      ?? parsed.pickupNr,
      notionPageId:  meta?.notionPageId  ?? null,
      files,
    })
  }

  return records
}

export function findFolderByAngebotnummer(
  basePath: string,
  angebotnummer: string,
): string | null {
  const stripped = stripLeadingZeros(angebotnummer)
  const records = scanFolders(basePath)
  for (const r of records) {
    if (r.angebotnummer && stripLeadingZeros(r.angebotnummer) === stripped) return r.folderPath
    const parts = r.folderName.split(' ')
    if (parts.some((p) => NUMERIC_RE.test(p) && stripLeadingZeros(p) === stripped)) return r.folderPath
  }
  return null
}

// ── 批量规范化文件夹名 ────────────────────────────────────────────

export interface FolderRenameItem {
  oldPath: string
  newPath: string
  oldName: string
  newName: string
}

/**
 * 计算需要重命名的文件夹列表（不实际执行）。
 * 目标格式：YYYY.MM.DD TYPE CC [Roman] [Angebotnr] [Pickup]
 * - 无法识别 type 或 country 的文件夹跳过
 * - angebotnummer 保留在文件夹名中（同时写入 meta）
 * - 同一 (date, type, country) 有多条时自动加罗马数字
 */
export function planFolderRenames(basePath: string): FolderRenameItem[] {
  const records = scanFolders(basePath)

  // 先把 angebotnummer 写入 meta（以免规范化后从文件夹名丢失）
  for (const r of records) {
    if (r.angebotnummer) {
      const meta = readFolderMeta(r.folderPath)
      if (meta && !meta.angebotnummer) {
        try { writeFolderMeta(r.folderPath, { ...meta, angebotnummer: r.angebotnummer }) } catch { /* ignore */ }
      }
    }
  }

  // 过滤出可以规范化的（有 type + 可解析 country + 2026年起才强制规范）
  type Normalizable = {
    record: ArchiveRecord
    normCountry: string
    type: CargoType
    pickupNr: string | null
  }
  const items: Normalizable[] = []
  for (const r of records) {
    if (r.date < '2026.01.01') continue     // 仅处理 2026 年起的文件夹
    const normCountry = normalizeCountry(r.country)
    if (!normCountry) continue              // 无法确定国家，跳过
    // type 默认 INV，一定有值，无需过滤
    items.push({ record: r, normCountry, type: r.type, pickupNr: r.pickupNr })
  }

  // 按 (date, normCountry, type) 分组，以便决定是否需要罗马数字
  const groups = new Map<string, Normalizable[]>()
  for (const item of items) {
    const key = `${item.record.date}|${item.normCountry}|${item.type}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(item)
  }

  const result: FolderRenameItem[] = []

  for (const [, group] of groups) {
    const is2026Plus = group[0].record.date >= '2026.01.01'
    const needsRoman = group.length > 1 || is2026Plus
    // 按文件夹名排序，保持历史顺序
    group.sort((a, b) => a.record.folderName.localeCompare(b.record.folderName))

    group.forEach((item, idx) => {
      const roman = needsRoman ? (ROMAN_NUMERALS[idx] ?? `(${idx + 1})`) : ''
      const newName = buildFolderName(item.record.date, item.type, item.normCountry, roman, item.record.angebotnummer, item.pickupNr)
      if (newName === item.record.folderName) return  // 已经是标准格式

      const parent = join(item.record.folderPath, '..')
      const newPath = join(parent, newName)
      result.push({
        oldPath: item.record.folderPath,
        newPath,
        oldName: item.record.folderName,
        newName,
      })
    })
  }

  return result
}

export interface ExecuteRenamesResult {
  ok: boolean
  renamed: number
  errors: string[]
}

export function executeFolderRenames(renames: FolderRenameItem[]): ExecuteRenamesResult {
  const errors: string[] = []
  let renamed = 0
  for (const item of renames) {
    try {
      renameSync(item.oldPath, item.newPath)
      renamed++
    } catch (e) {
      errors.push(`${item.oldName} → ${item.newName}: ${String(e)}`)
    }
  }
  return { ok: errors.length === 0, renamed, errors }
}
