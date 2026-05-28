import { Client } from '@notionhq/client'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints'

export type CargoType = 'INV' | 'BATT' | 'ACC'
export type InquiryStatus =
  | '待询价' | '已询价' | '已报价' | '要求出货' | '已要求出货'
  | '已确认' | '已填表' | '已要求提货' | '已提货' | '已收账单'

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
  dimensions: string | null
  status: InquiryStatus
  angebotnummer: string | null
  amount: number | null
  rswCode: string | null
  trackingNr: string | null
  invoiceNr: string | null
  rechnungAmount: number | null
  rechnungAmountBrutto: number | null
  folderPath: string | null
  remark: string | null
}

export function checkAuth(req: VercelRequest, res: VercelResponse): boolean {
  if (req.headers['x-app-password'] !== process.env.APP_PASSWORD) {
    res.status(401).json({ error: 'Unauthorized' })
    return false
  }
  return true
}

export function getNotion(): Client {
  return new Client({ auth: process.env.NOTION_TOKEN })
}

export const DB_ID = process.env.NOTION_DATABASE_ID as string

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
  if (!iso) return null
  return iso.replace(/-/g, '.')
}

export function parseNotionPage(page: PageObjectResponse): NotionRecord {
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
    ldm:                 getNumber(props, 'LDM'),
    dimensions:          getText(props, '尺寸'),
    status:              (getSelect(props, '状态') as InquiryStatus | null) ?? '待询价',
    angebotnummer:       getText(props, 'Preisangebot Nr'),
    amount:              getNumber(props, '报价金额'),
    rswCode:             getText(props, 'Pickup#'),
    trackingNr:          getText(props, 'Tracking Nr'),
    invoiceNr:           getText(props, '账单号'),
    rechnungAmount:      getNumber(props, '账单金额（netto）'),
    rechnungAmountBrutto:getNumber(props, '账单金额（brutto）'),
    folderPath:          getText(props, '文件夹路径'),
    remark:              getText(props, '备注'),
  }
}

export function richText(value: string) {
  return { rich_text: [{ text: { content: value } }] }
}
