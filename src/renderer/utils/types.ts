export type CargoType = 'INV' | 'BATT' | 'ACC'

export type InquiryStatus =
  | '待询价'
  | '已询价'
  | '已报价'
  | '要求出货'
  | '已要求出货'
  | '已要求提货'
  | '已收账单'

export const INQUIRY_STATUSES: InquiryStatus[] = [
  '待询价', '已询价', '已报价', '要求出货', '已要求出货', '已要求提货', '已收账单',
]

export interface FormData {
  recipient: string
  pallets: string
  dimensions: string
  loadingMeters: string
  weight: string
  address1: string
  address2: string
  address3: string
  cargoType: CargoType
  hasInsurance: boolean
  insuranceAmount: string
}

export const defaultFormData: FormData = {
  recipient: '',
  pallets: '',
  dimensions: '',
  loadingMeters: '',
  weight: '',
  address1: '',
  address2: '',
  address3: '',
  cargoType: 'INV',
  hasInsurance: false,
  insuranceAmount: ''
}

export interface EmailContent {
  subject: string
  body: string
}

/** 每个档案文件夹内的 .logianfrage.json 内容 */
export interface FolderMeta {
  notionPageId: string | null
  angebotnummer: string | null
  pickupNr: string | null
  type: CargoType
  country: string
  date: string  // YYYY.MM.DD
}

/** Notion 数据库中一条询价记录（来自 Notion API）*/
export interface NotionRecord {
  notionPageId: string
  date: string             // YYYY.MM.DD
  type: CargoType
  country: string
  address: string | null
  postalCode: string | null
  city: string | null
  pallets: number | null
  weight: number | null
  volume: number | null    // CBM
  dimensions: string | null
  ldm: number | null
  status: InquiryStatus
  angebotnummer: string | null
  amount: number | null    // 报价金额
  rswCode: string | null
  trackingNr: string | null
  rechnungAmount: number | null       // 账单金额（netto）
  rechnungAmountBrutto: number | null // 账单金额（brutto）
  invoiceNr: string | null            // 账单号
  folderPath: string | null
  remark: string | null
}

/** 档案记录：NotionRecord + 本地文件系统信息（可能为空）*/
export interface ArchiveRecord extends NotionRecord {
  folderName: string | null   // 仅文件夹名（无本地文件夹时为 null）
  romanNumeral: string        // I / II / III ...
  files: string[]             // 文件夹内所有文件名
}

/** Notion 集成配置 */
export interface NotionConfig {
  token: string
  databaseId: string
}

/** 邮件收发配置 */
export interface EmailConfig {
  smtpHost: string      // smtp.qiye.aliyun.com
  smtpPort: 25 | 465
  smtpSsl: boolean
  imapHost: string      // imap.qiye.aliyun.com
  imapPort: 993 | 143
  imapSsl: boolean
  username: string
  password: string
  defaultRecipient?: string  // 默认询价收件人
  signature?: string         // 邮件签名（纯文本）
  filterKeywords?: string[]  // 邮件过滤关键词（匹配 from/to 包含任一即保留），默认 ['dachser']
}

export interface EmailMessage {
  uid: number
  from: string
  subject: string
  date: string
  hasAttachment: boolean
  seen: boolean
  folder: string   // IMAP folder path this message lives in
}

export interface EmailAttachment {
  index: number
  filename: string
  size: number
  contentType: string
}

export interface EmailDetail extends EmailMessage {
  bodyHtml: string | null
  bodyText: string | null
  attachments: EmailAttachment[]
}

/** 应用级配置（存储在 userData/logianfrage-config.json） */
export interface AppConfig {
  notion: NotionConfig | null
  basePath: string
  email: EmailConfig | null
}

export const DEFAULT_BASE_PATH = '/Volumes/SSD-G/WorkHistory/SWS/007 Logistics'
