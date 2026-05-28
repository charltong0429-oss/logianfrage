#!/usr/bin/env node
/**
 * 一次性 Notion 初始化脚本
 * 扫描本地文件夹 → 创建 Notion 记录
 *
 * 用法：
 *   node scripts/init-notion.js --dry-run   预览，不写 Notion
 *   node scripts/init-notion.js             执行写入
 */

'use strict'
const fs   = require('fs')
const path = require('path')
const os   = require('os')

const XLSX     = require('xlsx')
const pdfParse = require('pdf-parse')
const { Client } = require('@notionhq/client')

const DRY_RUN   = process.argv.includes('--dry-run')
const BASE_PATH = '/Volumes/SSD-G/WorkHistory/SWS/007 Logistics'
const YEARS     = ['2025', '2026']

// ── Config ────────────────────────────────────────────────────────

function readConfig() {
  const p = path.join(os.homedir(), 'Library', 'Application Support',
                      'logianfrage', 'logianfrage-config.json')
  return JSON.parse(fs.readFileSync(p, 'utf-8'))
}

// ── Country normalization ─────────────────────────────────────────

// Non-standard codes and full names → ISO 3166-1 alpha-2
// IMPORTANT: check this map BEFORE treating a 2-letter string as already ISO
const COUNTRY_MAP = {
  // Non-standard 2/3-letter codes used in folder names
  'os': 'AT', 'bul': 'BG', 'fin': 'FI', 'pvc': 'DE',
  // English full names
  'france': 'FR', 'poland': 'PL', 'italy': 'IT', 'germany': 'DE',
  'austria': 'AT', 'finland': 'FI', 'bulgaria': 'BG', 'romania': 'RO',
  'hungary': 'HU', 'croatia': 'HR', 'moldova': 'MD', 'serbia': 'RS',
  'armenia': 'AM', 'spain': 'ES', 'portugal': 'PT',
  'bosnia and herzegovina': 'BA', 'bosnia': 'BA', 'bih': 'BA',
  'netherlands': 'NL', 'belgium': 'BE', 'switzerland': 'CH',
  'czech republic': 'CZ', 'czechia': 'CZ', 'czech': 'CZ',
  'slovakia': 'SK', 'slovenia': 'SI', 'greece': 'GR',
  'denmark': 'DK', 'sweden': 'SE', 'norway': 'NO',
  'ukraine': 'UA', 'turkey': 'TR', 'lithuania': 'LT',
  'latvia': 'LV', 'estonia': 'EE', 'albania': 'AL',
  // Chinese names
  '波兰': 'PL', '法国': 'FR', '意大利': 'IT', '德国': 'DE',
  '奥地利': 'AT', '芬兰': 'FI', '保加利亚': 'BG', '罗马尼亚': 'RO',
  '匈牙利': 'HU', '克罗地亚': 'HR', '摩尔多瓦': 'MD', '塞尔维亚': 'RS',
  '亚美尼亚': 'AM', '西班牙': 'ES', '葡萄牙': 'PT', '波黑': 'BA',
  '捷克': 'CZ', '马德里': 'ES', '摩尔多': 'MD',
  // Known city/company → country
  'lastrup': 'DE',
}

// Known valid ISO-2 codes in use (others like OS are non-standard)
const VALID_ISO2 = new Set([
  'AT','BE','BG','BA','CH','CZ','DE','DK','EE','ES','FI','FR','GB',
  'GR','HR','HU','IT','LT','LV','MD','NL','NO','PL','PT','RO','RS',
  'SE','SI','SK','TR','UA','AM','AL','MD',
])

function toISO(raw) {
  if (!raw) return null
  const s = String(raw).trim()
  const lower = s.toLowerCase()
  // Check map first (handles OS, BUL, FIN, full names, Chinese)
  if (Object.prototype.hasOwnProperty.call(COUNTRY_MAP, lower)) {
    return COUNTRY_MAP[lower]  // may be null for unknowns
  }
  // Only accept 2-letter uppercase if it's a known ISO code
  if (/^[A-Z]{2}$/.test(s) && VALID_ISO2.has(s)) return s
  // Partial match in English names
  for (const [key, val] of Object.entries(COUNTRY_MAP)) {
    if (key.length > 3 && lower.includes(key)) return val
  }
  return null
}

// ── Type inference ────────────────────────────────────────────────

function inferType(text) {
  if (!text) return null
  const u = text.toUpperCase()
  if (/\bBATT(ERY)?\b|电池|AKKU/.test(u)) return 'BATT'
  if (/\bINV(ERTER)?\b|逆变器/.test(u)) return 'INV'
  if (/\bACC\b/.test(u)) return 'ACC'
  return null
}

// ── Number parsing ────────────────────────────────────────────────

function parseNum(str) {
  if (str === null || str === undefined) return null
  const m = String(str).match(/(\d+(?:[.,]\d+)?)/)
  if (!m) return null
  const n = parseFloat(m[1].replace(',', '.'))
  return isNaN(n) ? null : n
}

// ── Excel reading ─────────────────────────────────────────────────

function readShipmentExcel(filePath) {
  try {
    const wb = XLSX.readFile(filePath)
    const ws = wb.Sheets[wb.SheetNames[0]]
    const get = (cell) => ws[cell] ? ws[cell].v : null

    const countryRaw = get('D24')
    const country    = toISO(countryRaw ? String(countryRaw) : null)

    // D16 label says "Loading meters" — only store as LDM if no CBM suffix
    const d16raw = get('D16')
    const d16str = d16raw ? String(d16raw) : ''
    const ldm = /cbm|m³/i.test(d16str) ? null : parseNum(d16str)

    const prodDesc = [get('D13'), get('D14')].filter(Boolean).join(' ')

    // Fallback country from D23 or D22 (some old Excels put country name in D23)
    let countryFallback = null
    if (!country) {
      const d23 = String(get('D23') || '')
      countryFallback = toISO(d23)
    }
    if (!countryFallback) {
      const addr = String(get('D22') || '').toLowerCase()
      countryFallback = toISO(addr)
    }

    // Only use D23 as postalCode if it doesn't look like a plain country name
    const d23raw = get('D23') ? String(get('D23')) : null
    const d23IsCountry = d23raw ? !!toISO(d23raw) : false

    return {
      country: country || countryFallback,
      countryRaw: countryRaw ? String(countryRaw) : null,
      pallets: parseNum(String(get('D13') || '')),
      weight:  parseNum(String(get('D17') || '')),
      ldm,
      address:    get('D22') ? String(get('D22')).split('\n')[0] : null,
      postalCode: (!d23IsCountry && d23raw) ? d23raw : null,
      prodDesc,
    }
  } catch {
    return null
  }
}

// ── Preisangebot PDF amount extraction ───────────────────────────

async function extractPreisAmount(filePath) {
  try {
    const buf  = fs.readFileSync(filePath)
    const { text } = await pdfParse(buf)
    const m =
      text.match(/Gesamtbetrag[^€\d]*([\d.,]+)\s*EUR/i) ??
      text.match(/Netto\s+EUR\s+([\d.,]+)/i) ??
      text.match(/Betrag[^€\d]*([\d.,]+)\s*EUR/i)
    if (!m) return null
    const n = parseFloat(m[1].replace(/\./g, '').replace(',', '.'))
    return isNaN(n) ? null : n
  } catch {
    return null
  }
}

// ── Status derivation ─────────────────────────────────────────────

function deriveStatus(folderName, files) {
  const lower    = files.map(f => f.toLowerCase())
  const rswMatch = (folderName || '').match(/\b(RSW\d+-[A-Z])\b/i)
  const rswCode  = rswMatch ? rswMatch[1].toUpperCase() : null

  let angebotnummer = null
  const preisFile = files.find(f => /^dachser_preisangebot/i.test(f) && f.endsWith('.pdf'))
  if (preisFile) {
    const m = preisFile.match(/(\d+)\.pdf$/i)
    if (m) angebotnummer = m[1]
  }

  // (r)Speditionsauftrag_* = filled/modified by user
  const hasFilledSped = lower.some(f => /^\(r\)speditionsauftrag/i.test(f) && f.endsWith('.pdf'))
  const hasPreis      = lower.some(f => /preisangebot/i.test(f) && f.endsWith('.pdf'))
  const hasSped       = lower.some(f => /speditionsauftrag/i.test(f) && f.endsWith('.pdf'))

  let status
  if      (hasFilledSped && rswCode) status = '已要求提货'
  else if (hasFilledSped)            status = '已填表'
  else if (rswCode)                  status = '已确认'
  else if (hasSped || hasPreis)      status = '已报价'
  else                               status = '已询价'

  return { status, angebotnummer, rswCode }
}

// ── Folder name parser ────────────────────────────────────────────

const TYPE_RE = /^(INV|BATT|ACC)$/i

function parseFolderName(name) {
  const parts = name.split(' ')
  const date  = parts[0]

  const rswMatch = name.match(/\b(RSW\d+-[A-Z])\b/i)
  const pickupNr = rswMatch ? rswMatch[1].toUpperCase() : null

  // Strip SWS-XXXXXXXX from name before looking for standalone 8-digit angebotnummer
  const nameNoSws = name.replace(/\bSWS-\d+\b/g, '')
  const angMatch = nameNoSws.match(/\b(\d{8})\b/)
  // Reject if it looks like a date (20XXXXXX) — those are SWS order dates, not Preisangebot Nrs
  const angebotnummer = (angMatch && !/^20\d{6}$/.test(angMatch[1])) ? angMatch[1] : null

  const typePart = parts.find((p, i) => i > 0 && TYPE_RE.test(p))
  const type = typePart ? typePart.toUpperCase() : null

  // Country: first token that is all letters, not date/type/RSW/roman/SWS/digits
  const romanRE = /^(I{1,4}|II?V?|VI{0,3}|IX)$/
  let country = null
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i]
    if (TYPE_RE.test(p)) continue
    if (/^SWS-/i.test(p)) continue
    if (/RSW\d+-[A-Z]/i.test(p)) continue
    if (/\d/.test(p)) continue           // skip any token containing digits (like "13p", "60K")
    if (romanRE.test(p)) continue
    if (p.length === 0) continue
    country = p
    break
  }

  return { date, type, country, angebotnummer, pickupNr }
}

// ── Folder scanning ───────────────────────────────────────────────

function listVisible(dir) {
  try {
    return fs.readdirSync(dir).filter(f => !f.startsWith('.') && !f.startsWith('~$') && !f.startsWith('._'))
  } catch { return [] }
}

function scanAllFolders() {
  const results = []
  for (const year of YEARS) {
    const yearDir = path.join(BASE_PATH, year)
    if (!fs.existsSync(yearDir)) continue
    for (const month of listVisible(yearDir)) {
      const monthDir = path.join(yearDir, month)
      if (!fs.statSync(monthDir).isDirectory()) continue
      for (const folderName of listVisible(monthDir)) {
        const folderPath = path.join(monthDir, folderName)
        const stat = fs.statSync(folderPath)
        if (!stat.isDirectory()) continue

        const entries = listVisible(folderPath)
        const files   = entries.filter(e => fs.statSync(path.join(folderPath, e)).isFile())
        const subDirs = entries.filter(e => fs.statSync(path.join(folderPath, e)).isDirectory())

        if (files.length === 0 && subDirs.length > 0) {
          // Special: parent folder grouping multiple sub-orders (e.g. "Lastrup 3 单")
          for (const sub of subDirs) {
            const subPath  = path.join(folderPath, sub)
            const subFiles = listVisible(subPath).filter(f => fs.statSync(path.join(subPath, f)).isFile())
            results.push({ folderName, folderPath: subPath, files: subFiles, parentDate: folderName.split(' ')[0] })
          }
        } else {
          results.push({ folderName, folderPath, files })
        }
      }
    }
  }
  return results
}

// ── Build record ──────────────────────────────────────────────────

async function buildRecord({ folderName, folderPath, files }) {
  const parsed  = parseFolderName(folderName)
  const derived = deriveStatus(folderName, files)

  // Find Shipment Inquiry Excel (skip temp files)
  const excelFile = files.find(f => /shipment.*inquiry/i.test(f) && /\.xlsx?$/i.test(f))
  let excelData = null
  if (excelFile) {
    excelData = readShipmentExcel(path.join(folderPath, excelFile))
  }

  // Type: folder → folder hints → Excel product description → default INV
  let type = parsed.type
  if (!type) type = inferType(folderName)
  if (!type && excelData?.prodDesc) type = inferType(excelData.prodDesc)
  if (!type) type = 'INV'

  // Country: folder token → Excel D24 → Excel D22 fallback
  let country = null
  if (parsed.country) {
    country = toISO(parsed.country)
  }
  if (!country && excelData?.country) country = excelData.country

  // Angebotnummer: from Preisangebot file > folder name
  const angebotnummer = derived.angebotnummer ?? parsed.angebotnummer

  // Preisangebot amount
  let amount = null
  const preisFile = files.find(f => /^DACHSER_Preisangebot/i.test(f) && f.endsWith('.pdf'))
  if (preisFile) {
    amount = await extractPreisAmount(path.join(folderPath, preisFile))
  }

  return {
    folderName,
    folderPath,
    date:         parsed.date,
    type,
    country:      country || '??',
    status:       derived.status,
    angebotnummer,
    rswCode:      derived.rswCode,
    amount,
    pallets:      excelData?.pallets ?? null,
    weight:       excelData?.weight  ?? null,
    ldm:          excelData?.ldm     ?? null,
    needsReview:  !country,
  }
}

// ── Notion write ──────────────────────────────────────────────────

function richText(val) {
  return { rich_text: [{ text: { content: String(val) } }] }
}

async function createNotionPage(notion, databaseId, rec) {
  const props = {
    '日期':   { date: { start: rec.date.replace(/\./g, '-') } },
    '类型':   { select: { name: rec.type } },
    '目的国': { select: { name: rec.country } },
    '状态':   { select: { name: rec.status } },
  }
  if (rec.angebotnummer) props['Preisangebot Nr'] = richText(rec.angebotnummer)
  if (rec.rswCode)       props['Pickup#']         = richText(rec.rswCode)
  if (rec.amount !== null) props['报价金额']       = { number: rec.amount }
  if (rec.folderPath)    props['文件夹路径']        = richText(rec.folderPath)
  if (rec.pallets !== null) props['托盘数']        = { number: rec.pallets }
  if (rec.weight  !== null) props['重量']          = { number: rec.weight }
  if (rec.ldm     !== null) props['LDM']           = { number: rec.ldm }

  const response = await notion.pages.create({
    parent: { database_id: databaseId },
    properties: props,
  })
  return response.id
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  const config = readConfig()
  if (!config.notion?.token || !config.notion?.databaseId) {
    console.error('❌ 请先在应用设置中配置 Notion Token 和 Database ID')
    process.exit(1)
  }
  const notion     = new Client({ auth: config.notion.token })
  const databaseId = config.notion.databaseId

  console.log(`\n🔍 扫描文件夹…`)
  const folders = scanAllFolders()
  console.log(`   共发现 ${folders.length} 个文件/子订单\n`)

  const records = []
  for (const folder of folders) {
    const rec = await buildRecord(folder)
    records.push(rec)
  }

  // Print preview table
  const needsReview = records.filter(r => r.needsReview)
  console.log('─'.repeat(100))
  console.log('日期          类型  国家  状态          Angebot       RSW          文件夹')
  console.log('─'.repeat(100))
  for (const r of records) {
    const flag = r.needsReview ? ' ⚠️' : ''
    console.log(
      `${r.date}  ${r.type.padEnd(4)}  ${r.country.padEnd(4)}  ${r.status.padEnd(12)}  ` +
      `${(r.angebotnummer || '').padEnd(12)}  ${(r.rswCode || '').padEnd(12)}  ` +
      path.basename(r.folderPath) + flag
    )
  }
  console.log('─'.repeat(100))
  console.log(`总计: ${records.length} 条  |  需人工检查: ${needsReview.length} 条\n`)

  if (needsReview.length > 0) {
    console.log('⚠️  以下记录无法识别国家代码（目的国 ??），将被跳过：')
    for (const r of needsReview) {
      console.log(`   ${r.date} ${r.type} → ${path.basename(r.folderPath)}`)
    }
    console.log()
  }

  if (DRY_RUN) {
    console.log('✅ DRY RUN 完成，未写入 Notion。去掉 --dry-run 后重新运行以执行写入。\n')
    return
  }

  // Write to Notion
  console.log(`\n📝 写入 Notion（共 ${records.length} 条）…`)
  let ok = 0, fail = 0, skipped = 0
  for (let i = 0; i < records.length; i++) {
    const rec = records[i]
    const label = `${rec.date} ${rec.type} ${rec.country}`
    if (rec.country === '??') {
      console.log(`  [${i+1}/${records.length}] ⚠️  跳过: ${label} — ${path.basename(rec.folderPath)}`)
      skipped++
      continue
    }
    try {
      await createNotionPage(notion, databaseId, rec)
      console.log(`  [${i+1}/${records.length}] ✓  ${label}  ${rec.status}  ${rec.angebotnummer || ''}`)
      ok++
      await new Promise(r => setTimeout(r, 350))  // Notion rate limit
    } catch (e) {
      console.log(`  [${i+1}/${records.length}] ✗  失败: ${label} — ${e.message}`)
      fail++
    }
  }
  console.log(`\n✅ 完成：${ok} 条成功，${skipped} 条跳过，${fail} 条失败\n`)
}

main().catch(e => { console.error(e); process.exit(1) })
