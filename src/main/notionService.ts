import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { Client } from '@notionhq/client'
import type { PageObjectResponse, QueryDatabaseResponse } from '@notionhq/client/build/src/api-endpoints'
import type { NotionConfig, AppConfig, CargoType, InquiryStatus, NotionRecord } from '../renderer/utils/types'
import { DEFAULT_BASE_PATH } from '../renderer/utils/types'

const CONFIG_FILENAME = 'logianfrage-config.json'

// ── Config read/write ─────────────────────────────────────────────

export function readAppConfig(userData: string): AppConfig {
  const configPath = join(userData, CONFIG_FILENAME)
  try {
    if (existsSync(configPath)) {
      return JSON.parse(readFileSync(configPath, 'utf-8')) as AppConfig
    }
  } catch { /* ignore parse errors */ }
  return { notion: null, basePath: DEFAULT_BASE_PATH }
}

export function saveAppConfig(userData: string, config: AppConfig): void {
  const configPath = join(userData, CONFIG_FILENAME)
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
}

// ── Connection test ───────────────────────────────────────────────

export interface NotionResult {
  ok: boolean
  error?: string
  pageId?: string
}

// All property names the app reads from/writes to Notion
const EXPECTED_PROPS: Record<string, string> = {
  '日期': 'date',
  '类型': 'select',
  '目的国': 'select',
  '地址': 'rich_text',
  '邮编': 'rich_text',
  '城市': 'rich_text',
  '托盘数': 'number',
  '重量': 'number',
  '体积': 'number',
  '尺寸': 'rich_text',
  'LDM': 'number',
  '状态': 'select',
  'Preisangebot Nr': 'rich_text',
  '报价金额': 'number',
  'Pickup#': 'rich_text',
  'Tracking Nr': 'rich_text',
  '账单金额（netto）': 'number',
  '账单金额（brutto）': 'number',
  '账单号': 'number',
  '文件夹路径': 'rich_text',
  '备注': 'rich_text',
}

export interface PropCheckResult {
  ok: boolean
  missing: string[]    // expected but not in DB
  typeMismatch: { name: string; expected: string; actual: string }[]
  extra: string[]      // in DB but not expected (informational)
}

export async function checkDatabaseProperties(notionConfig: NotionConfig): Promise<PropCheckResult> {
  const notion = new Client({ auth: notionConfig.token })
  const db = await notion.databases.retrieve({ database_id: notionConfig.databaseId })
  const actualProps = db.properties

  const missing: string[] = []
  const typeMismatch: PropCheckResult['typeMismatch'] = []
  for (const [name, expectedType] of Object.entries(EXPECTED_PROPS)) {
    const actual = actualProps[name]
    if (!actual) { missing.push(name); continue }
    if (actual.type !== expectedType) typeMismatch.push({ name, expected: expectedType, actual: actual.type })
  }
  const extra = Object.keys(actualProps).filter(k => !(k in EXPECTED_PROPS))
  return { ok: missing.length === 0 && typeMismatch.length === 0, missing, typeMismatch, extra }
}

export async function testConnection(notionConfig: NotionConfig): Promise<NotionResult> {
  try {
    const notion = new Client({ auth: notionConfig.token })
    await notion.databases.retrieve({ database_id: notionConfig.databaseId })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

// ── Notion page property parsers ──────────────────────────────────

function getText(props: PageObjectResponse['properties'], name: string): string | null {
  const p = props[name]
  if (!p) return null
  if (p.type === 'rich_text') return p.rich_text[0]?.plain_text ?? null
  if (p.type === 'title')     return p.title[0]?.plain_text ?? null
  if (p.type === 'url')       return p.url ?? null
  if (p.type === 'phone_number') return p.phone_number ?? null
  if (p.type === 'email')     return p.email ?? null
  return null
}

function getSelect(props: PageObjectResponse['properties'], name: string): string | null {
  const p = props[name]
  if (!p || p.type !== 'select') return null
  return p.select?.name ?? null
}

function getNumber(props: PageObjectResponse['properties'], name: string): number | null {
  const p = props[name]
  if (!p || p.type !== 'number') return null
  return p.number ?? null
}

function getDate(props: PageObjectResponse['properties'], name: string): string | null {
  const p = props[name]
  if (!p || p.type !== 'date') return null
  const iso = p.date?.start ?? null
  if (!iso) return null
  return iso.replace(/-/g, '.')   // "2026-04-10" → "2026.04.10"
}

function parseNotionPage(page: PageObjectResponse): NotionRecord {
  const props = page.properties
  return {
    notionPageId: page.id,
    date:          getDate(props, '日期') ?? '',
    type:          (getSelect(props, '类型') as CargoType | null) ?? 'INV',
    country:       getSelect(props, '目的国') ?? '',
    address:       getText(props, '地址'),
    postalCode:    getText(props, '邮编'),
    city:          getText(props, '城市'),
    pallets:       getNumber(props, '托盘数'),
    weight:        getNumber(props, '重量'),
    volume:        getNumber(props, '体积'),
    dimensions:    getText(props, '尺寸'),
    ldm:           getNumber(props, 'LDM'),
    status:        (getSelect(props, '状态') as InquiryStatus | null) ?? '待询价',
    angebotnummer: getText(props, 'Preisangebot Nr'),
    amount:        getNumber(props, '报价金额'),
    rswCode:       getText(props, 'Pickup#'),
    trackingNr:    getText(props, 'Tracking Nr'),
    rechnungAmount:       getNumber(props, '账单金额（netto）'),
    rechnungAmountBrutto: getNumber(props, '账单金额（brutto）'),
    invoiceNr:     getNumber(props, '账单号')?.toString() ?? null,
    folderPath:    getText(props, '文件夹路径'),
    remark:        getText(props, '备注'),
  }
}

// ── Fetch records (read from Notion) ─────────────────────────────

export async function fetchAllRecords(notionConfig: NotionConfig): Promise<NotionRecord[]> {
  const notion = new Client({ auth: notionConfig.token })
  const records: NotionRecord[] = []
  let cursor: string | undefined = undefined

  do {
    const response: QueryDatabaseResponse = await notion.databases.query({
      database_id: notionConfig.databaseId,
      sorts: [{ property: '日期', direction: 'descending' }],
      start_cursor: cursor,
      page_size: 100,
    })

    for (const page of response.results) {
      if (page.object === 'page' && 'properties' in page) {
        records.push(parseNotionPage(page as PageObjectResponse))
      }
    }

    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined
  } while (cursor)

  return records
}

export async function fetchRecord(notionConfig: NotionConfig, pageId: string): Promise<NotionRecord | null> {
  try {
    const notion = new Client({ auth: notionConfig.token })
    const page = await notion.pages.retrieve({ page_id: pageId })
    if ('properties' in page) {
      return parseNotionPage(page as PageObjectResponse)
    }
    return null
  } catch (e) {
    return null
  }
}

// ── Property builders (write to Notion) ──────────────────────────

function richText(value: string) {
  return { rich_text: [{ text: { content: value } }] }
}

/** 从数字中解析，中德文格式兼容 */
function parseNumber(s: string | number | null | undefined): number | null {
  if (s === null || s === undefined) return null
  if (typeof s === 'number') return isNaN(s) ? null : s
  const cleaned = String(s).replace(/,/g, '')
  const m = cleaned.match(/\d+\.?\d*/)
  if (!m) return null
  const n = parseFloat(m[0])
  return isNaN(n) ? null : n
}

/** 从文本推断货物类型 */
function inferTypeFromText(text: string, fallback: string): string {
  const u = text.toUpperCase()
  if (u.includes('BATTERY') || u.includes('BATT')) return 'BATT'
  if (u.includes('INVERTER') || u.includes('INV'))  return 'INV'
  if (u.includes('ACC'))                             return 'ACC'
  return fallback
}

// ── Create / Update params ────────────────────────────────────────

export interface CreatePageParams {
  date: string           // YYYY.MM.DD
  type: CargoType
  country: string
  address?: string | null
  postalCode?: string | null
  city?: string | null
  pallets?: number | string | null
  weight?: number | string | null
  volume?: number | string | null
  ldm?: number | string | null
  status?: InquiryStatus
  folderPath?: string | null
  remark?: string | null
}

export interface UpdatePageParams {
  status?: InquiryStatus
  angebotnummer?: string | null
  amount?: number | null         // 报价金额
  rswCode?: string | null
  trackingNr?: string | null
  rechnungAmount?: number | null        // 账单金额（netto）
  rechnungAmountBrutto?: number | null  // 账单金额（brutto）
  invoiceNr?: string | null             // 账单号
  folderPath?: string | null
  pallets?: number | null
  weight?: number | null
  ldm?: number | null
}

// ── Notion CRUD ───────────────────────────────────────────────────

export async function createPage(
  notionConfig: NotionConfig,
  params: CreatePageParams,
): Promise<NotionResult> {
  try {
    const notion = new Client({ auth: notionConfig.token })
    const isoDate = params.date.replace(/\./g, '-')
    const type = typeof params.pallets === 'string'
      ? inferTypeFromText(params.pallets, params.type)
      : params.type

    const properties: Record<string, unknown> = {
      '日期':  { date: { start: isoDate } },
      '类型':  { select: { name: type } },
      '状态':  { select: { name: params.status ?? '待询价' } },
    }

    if (params.country)    properties['目的国']    = { select: { name: params.country } }
    if (params.address)    properties['地址']       = richText(params.address)
    if (params.postalCode) properties['邮编']       = richText(params.postalCode)
    if (params.city)       properties['城市']       = richText(params.city)
    if (params.folderPath) properties['文件夹路径']  = richText(params.folderPath)
    if (params.remark)     properties['备注']       = richText(params.remark)

    const palletsNum = parseNumber(params.pallets)
    const weightNum  = parseNumber(params.weight)
    const volumeNum  = parseNumber(params.volume)
    const ldmNum     = parseNumber(params.ldm)
    if (palletsNum !== null) properties['托盘数'] = { number: palletsNum }
    if (weightNum  !== null) properties['重量']   = { number: weightNum }
    if (volumeNum  !== null) properties['体积']   = { number: volumeNum }
    if (ldmNum     !== null) properties['LDM']    = { number: ldmNum }

    const response = await notion.pages.create({
      parent: { database_id: notionConfig.databaseId },
      properties,
    })
    return { ok: true, pageId: response.id }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function updatePage(
  notionConfig: NotionConfig,
  pageId: string,
  params: UpdatePageParams,
  retries = 1,
): Promise<NotionResult> {
  try {
    const notion = new Client({ auth: notionConfig.token })
    const properties: Record<string, unknown> = {}

    if (params.status !== undefined)
      properties['状态'] = { select: { name: params.status } }
    if (params.angebotnummer !== undefined && params.angebotnummer !== null)
      properties['Preisangebot Nr'] = richText(params.angebotnummer)
    if (params.amount !== null && params.amount !== undefined)
      properties['报价金额'] = { number: params.amount }
    if (params.rswCode !== undefined && params.rswCode !== null)
      properties['Pickup#'] = richText(params.rswCode)
    if (params.trackingNr !== undefined && params.trackingNr !== null)
      properties['Tracking Nr'] = richText(params.trackingNr)
    if (params.rechnungAmount !== null && params.rechnungAmount !== undefined)
      properties['账单金额（netto）'] = { number: params.rechnungAmount }
    if (params.rechnungAmountBrutto !== null && params.rechnungAmountBrutto !== undefined)
      properties['账单金额（brutto）'] = { number: params.rechnungAmountBrutto }
    if (params.invoiceNr !== undefined && params.invoiceNr !== null) {
      const nr = parseFloat(params.invoiceNr)
      if (!isNaN(nr)) properties['账单号'] = { number: nr }
    }
    if (params.folderPath !== undefined && params.folderPath !== null)
      properties['文件夹路径'] = richText(params.folderPath)
    if (params.pallets !== null && params.pallets !== undefined)
      properties['托盘数'] = { number: params.pallets }
    if (params.weight !== null && params.weight !== undefined)
      properties['重量'] = { number: params.weight }
    if (params.ldm !== null && params.ldm !== undefined)
      properties['LDM'] = { number: params.ldm }

    await notion.pages.update({ page_id: pageId, properties })
    return { ok: true }
  } catch (e) {
    const msg = String(e)
    // Retry once on transient errors (timeout, network)
    if (retries > 0 && (msg.includes('Timeout') || msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT'))) {
      await new Promise(r => setTimeout(r, 2000))
      return updatePage(notionConfig, pageId, params, retries - 1)
    }
    return { ok: false, error: msg }
  }
}
