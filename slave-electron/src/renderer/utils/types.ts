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
  dimensions: string | null
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

export const STATUS_COLORS: Record<InquiryStatus, string> = {
  '待询价':    'bg-blue-100 text-blue-800',
  '已询价':    'bg-yellow-100 text-yellow-800',
  '已报价':    'bg-green-100 text-green-700',
  '已确认':    'bg-green-200 text-green-900',
  '已填表':    'bg-purple-100 text-purple-800',
  '已要求提货':'bg-orange-100 text-orange-800',
  '已提货':    'bg-teal-100 text-teal-800',
  '已收账单':  'bg-gray-200 text-gray-700',
}

export const COUNTRIES: Array<{ code: string; label: string }> = [
  { code: 'DE', label: 'DE - 德国' },
  { code: 'FR', label: 'FR - 法国' },
  { code: 'IT', label: 'IT - 意大利' },
  { code: 'ES', label: 'ES - 西班牙' },
  { code: 'PL', label: 'PL - 波兰' },
  { code: 'NL', label: 'NL - 荷兰' },
  { code: 'BE', label: 'BE - 比利时' },
  { code: 'AT', label: 'AT - 奥地利' },
  { code: 'CH', label: 'CH - 瑞士' },
  { code: 'CZ', label: 'CZ - 捷克' },
  { code: 'SE', label: 'SE - 瑞典' },
  { code: 'NO', label: 'NO - 挪威' },
  { code: 'DK', label: 'DK - 丹麦' },
  { code: 'PT', label: 'PT - 葡萄牙' },
  { code: 'HU', label: 'HU - 匈牙利' },
  { code: 'RO', label: 'RO - 罗马尼亚' },
  { code: 'BG', label: 'BG - 保加利亚' },
  { code: 'HR', label: 'HR - 克罗地亚' },
  { code: 'SK', label: 'SK - 斯洛伐克' },
  { code: 'SI', label: 'SI - 斯洛文尼亚' },
  { code: 'FI', label: 'FI - 芬兰' },
  { code: 'EE', label: 'EE - 爱沙尼亚' },
  { code: 'LV', label: 'LV - 拉脱维亚' },
  { code: 'LT', label: 'LT - 立陶宛' },
  { code: 'LU', label: 'LU - 卢森堡' },
  { code: 'GB', label: 'GB - 英国' },
  { code: 'TR', label: 'TR - 土耳其' },
]
