import * as XLSX from 'xlsx'
import type { NotionRecord } from './types'

export function exportInquiryExcel(record: NotionRecord): void {
  const wb = XLSX.utils.book_new()
  const ws: XLSX.WorkSheet = {}

  ws['D13'] = { v: `${record.pallets ?? ''} Pallets ${record.type}`, t: 's' }
  ws['D17'] = { v: `${record.weight ?? ''} kg`, t: 's' }
  if (record.ldm != null) ws['D16'] = { v: `${record.ldm} LDM`, t: 's' }
  if (record.address)     ws['D22'] = { v: record.address, t: 's' }
  ws['D23'] = { v: [record.postalCode, record.city].filter(Boolean).join(' '), t: 's' }
  ws['D24'] = { v: record.country, t: 's' }
  ws['!ref'] = 'A1:E30'

  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  XLSX.writeFile(wb, `Inquiry_${record.date}_${record.type}_${record.country}.xlsx`)
}
