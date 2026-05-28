import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { Client } from '@notionhq/client'
import type { PageObjectResponse, QueryDatabaseResponse } from '@notionhq/client/build/src/api-endpoints'

export interface NotionConfig {
  token: string
  databaseId: string
}

export interface SlaveConfig {
  notion: NotionConfig | null
}

export type CargoType = 'INV' | 'BATT' | 'ACC'

export type InquiryStatus =
  | '待询价' | '已询价' | '已报价' | '已确认'
  | '已填表' | '已要求提货' | '已提货' | '已收账单'

export interface NotionRecord {
  notionPageId: string
  date: string
  type: CargoType
  country: string
  address: string | null
  postalCode: string | null
  city: string | null
  pallets: number | null
  weight: number | null
  volume: number | null
  ldm: number | null
  status: InquiryStatus
  angebotnummer: string | null
  amount: number | null
  rswCode: string | null
  trackingNr: string | null
  rechnungAmount: number | null
  rechnungAmountBrutto: number | null
  folderPath: string | null
  remark: string | null
}

export interface CreateRecordParams {
  date: string
  type: CargoType
  country: string
  address?: string | null
  postalCode?: string | null
  city?: string | null
  pallets?: number | null
  weight?: number | null
  volume?: number | null
  dimensions?: string | null
  ldm?: number | null
  remark?: string | null
}

export interface UpdateRecordParams {
  status?: InquiryStatus
  rswCode?: string | null
  trackingNr?: string | null
}

// ── Config ────────────────────────────────────────────────────────

const CONFIG_FILE = 'slave-config.json'

export function readSlaveConfig(userData: string): SlaveConfig {
  const path = join(userData, CONFIG_FILE)
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf-8')) as SlaveConfig
  } catch { /* ignore */ }
  return { notion: null }
}

export function saveSlaveConfig(userData: string, config: SlaveConfig): void {
  writeFileSync(join(userData, CONFIG_FILE), JSON.stringify(config, null, 2), 'utf-8')
}

// ── Property helpers ──────────────────────────────────────────────

function richText(value: string) {
  return { rich_text: [{ text: { content: value } }] }
}

function getText(props: PageObjectResponse['properties'], name: string): string | null {
  const p = props[name]
  if (!p) return null
  if (p.type === 'rich_text') return p.rich_text[0]?.plain_text ?? null
  if (p.type === 'title')     return p.title[0]?.plain_text ?? null
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
  return iso ? iso.replace(/-/g, '.') : null
}

function parsePage(page: PageObjectResponse): NotionRecord {
  const props = page.properties
  return {
    notionPageId:        page.id,
    date:                getDate(props, '日期') ?? '',
    type:                (getSelect(props, '类型') as CargoType | null) ?? 'INV',
    country:             getSelect(props, '目的国') ?? '',
    address:             getText(props, '地址'),
    postalCode:          getText(props, '邮编'),
    city:                getText(props, '城市'),
    pallets:             getNumber(props, '托盘数'),
    weight:              getNumber(props, '重量'),
    volume:              getNumber(props, '体积'),
    dimensions:          getText(props, '尺寸'),
    ldm:                 getNumber(props, 'LDM'),
    status:              (getSelect(props, '状态') as InquiryStatus | null) ?? '待询价',
    angebotnummer:       getText(props, 'Preisangebot Nr'),
    amount:              getNumber(props, '报价金额'),
    rswCode:             getText(props, 'Pickup#'),
    trackingNr:          getText(props, 'Tracking Nr'),
    rechnungAmount:      getNumber(props, '账单金额（netto）'),
    rechnungAmountBrutto:getNumber(props, '账单金额（brutto）'),
    folderPath:          getText(props, '文件夹路径'),
    remark:              getText(props, '备注'),
  }
}

// ── Notion CRUD ───────────────────────────────────────────────────

export async function testConnection(cfg: NotionConfig): Promise<{ ok: boolean; error?: string }> {
  try {
    const notion = new Client({ auth: cfg.token })
    await notion.databases.retrieve({ database_id: cfg.databaseId })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function fetchAllRecords(cfg: NotionConfig): Promise<NotionRecord[]> {
  const notion = new Client({ auth: cfg.token })
  const records: NotionRecord[] = []
  let cursor: string | undefined

  do {
    const resp: QueryDatabaseResponse = await notion.databases.query({
      database_id: cfg.databaseId,
      sorts: [{ property: '日期', direction: 'descending' }],
      start_cursor: cursor,
      page_size: 100,
    })
    for (const page of resp.results) {
      if (page.object === 'page' && 'properties' in page)
        records.push(parsePage(page as PageObjectResponse))
    }
    cursor = resp.has_more ? (resp.next_cursor ?? undefined) : undefined
  } while (cursor)

  return records
}

export async function fetchRecord(cfg: NotionConfig, pageId: string): Promise<NotionRecord | null> {
  try {
    const notion = new Client({ auth: cfg.token })
    const page = await notion.pages.retrieve({ page_id: pageId }) as PageObjectResponse
    return parsePage(page)
  } catch {
    return null
  }
}

export async function createRecord(
  cfg: NotionConfig,
  params: CreateRecordParams,
): Promise<{ ok: boolean; pageId?: string; error?: string }> {
  try {
    const notion = new Client({ auth: cfg.token })
    const isoDate = params.date.replace(/\./g, '-')

    const properties: Record<string, unknown> = {
      '日期':  { date: { start: isoDate } },
      '类型':  { select: { name: params.type } },
      '目的国':{ select: { name: params.country } },
      '状态':  { select: { name: '待询价' } },
    }
    if (params.address)    properties['地址']  = richText(params.address)
    if (params.postalCode) properties['邮编']  = richText(params.postalCode)
    if (params.city)       properties['城市']  = richText(params.city)
    if (params.remark)     properties['备注']  = richText(params.remark)
    if (params.pallets != null) properties['托盘数'] = { number: params.pallets }
    if (params.weight  != null) properties['重量']   = { number: params.weight }
    if (params.volume      != null) properties['体积'] = { number: params.volume }
    if (params.dimensions)          properties['尺寸'] = richText(params.dimensions)
    if (params.ldm        != null)  properties['LDM'] = { number: params.ldm }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = await notion.pages.create({ parent: { database_id: cfg.databaseId }, properties: properties as any })
    return { ok: true, pageId: page.id }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function updateRecord(
  cfg: NotionConfig,
  pageId: string,
  params: UpdateRecordParams,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const notion = new Client({ auth: cfg.token })
    const properties: Record<string, unknown> = {}
    if (params.status)    properties['状态']    = { select: { name: params.status } }
    if (params.rswCode)   properties['Pickup#'] = richText(params.rswCode)
    if (params.trackingNr)properties['Tracking Nr'] = richText(params.trackingNr)

    await notion.pages.update({ page_id: pageId, properties: properties as any })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}
