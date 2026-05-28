import * as XLSX from 'xlsx'
import type { NotionRecord } from './types'

export function exportInquiryExcel(record: NotionRecord): void {
  const dims: string[] = record.dimensions
    ? record.dimensions.split(',').map((s: string) => s.trim()).filter(Boolean)
    : []

  const rows: (string | number | null)[][] = [
    ['Logistic Inquiry / 物流询价单'],
    [],
    ['日期 / Date',           record.date],
    ['类型 / Type',           record.type],
    ['目的国 / Country',      record.country],
    [],
    ['托盘数 / Pallets',      record.pallets ?? ''],
    ['重量 / Weight (kg)',    record.weight ?? ''],
    ['体积 / Volume (CBM)',   record.volume ?? ''],
    ['LDM',                   record.ldm ?? ''],
    [],
    ...dims.map((d: string, i: number) => [`尺寸 ${i + 1} / Dim ${i + 1}`, d] as (string | number | null)[]),
    ...(dims.length > 0 ? [[]] : []),
    ['地址 / Address',        record.address ?? ''],
    ['邮编 / Postal Code',    record.postalCode ?? ''],
    ['城市 / City',           record.city ?? ''],
    [],
    ['备注 / Remark',         record.remark ?? ''],
  ]

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(rows)

  ws['!cols'] = [{ wch: 22 }, { wch: 40 }]

  XLSX.utils.book_append_sheet(wb, ws, 'Inquiry')
  XLSX.writeFile(wb, `Inquiry_${record.date}_${record.type}_${record.country}.xlsx`)
}
