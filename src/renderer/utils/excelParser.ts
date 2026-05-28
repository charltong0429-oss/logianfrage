import * as XLSX from 'xlsx'
import { FormData } from './types'

/**
 * 从 xlsx 文件路径读取 Sheet1 中指定单元格，返回部分表单数据。
 * 单元格映射（PRD §3.1）：
 *   D13 → pallets
 *   D14 → dimensions
 *   D16 → loadingMeters
 *   D17 → weight
 *   D22 → address1
 *   D23 → address2
 *   D24 → address3
 */
export function parseExcelFile(filePath: string): Partial<FormData> {
  const workbook = XLSX.readFile(filePath)
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]

  const getCellValue = (cellRef: string): string => {
    const cell = sheet[cellRef]
    if (!cell) return ''
    return String(cell.v ?? '').trim()
  }

  return {
    pallets: getCellValue('D13'),
    dimensions: getCellValue('D14'),
    loadingMeters: getCellValue('D16'),
    weight: getCellValue('D17'),
    address1: getCellValue('D22'),
    address2: getCellValue('D23'),
    address3: getCellValue('D24')
  }
}
