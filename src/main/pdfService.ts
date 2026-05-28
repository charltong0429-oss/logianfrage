import { readFileSync, writeFileSync, unlinkSync } from 'fs'
import { spawn } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'

export interface RechnungPosition {
  aufNr: string | null          // from "XXXXX / RSW..." line (Auf-Nr)
  tagespreisNr: string | null   // stripped of leading zeros
  rswCode: string | null
  nettoAmount: number | null    // Positionsendbetrag
  destCountryCode: string | null  // 2-letter country code extracted from recipient address (e.g. "IT")
  destPostalCode: string | null   // postal code extracted from recipient address (e.g. "31050")
}

export interface RechnungData {
  positions: RechnungPosition[]
  nettoTotal: number | null
  bruttoTotal: number | null
  // backward-compat (first position's best Angebot号: aufNr ?? tagespreisNr)
  tagespreisNr: string | null
  bruttoAmount: string | null
}

export interface PreisangebotData {
  angebotnummer: string | null
  amount: number | null
  gefahrgut: boolean | null
  destCountryCode: string | null
  destZip: string | null
  destCity: string | null
  pallets: number | null
  volume: number | null    // Cbm
  weight: number | null    // Realgewicht (kg)
}

export interface PlData {
  company: string
  contact: string
  street: string
  plz: string
  ort: string
  nkz: string
  tel: string
}

export interface SpeditionsauftragData {
  date: string
  type: string
  country: string
  address: string
  postalCode: string
  city: string
  pallets: number | null
  weight: number | null
  volume: number | null
  ldm: number | null
  rswCode: string | null
  angebotnummer: string | null
}

interface PdfItem {
  str: string
  x: number
  y: number
}

async function extractPdfItems(filePath: string): Promise<PdfItem[]> {
  // new Function prevents esbuild from rewriting import() → require().
  // pdfjs-dist is ESM-only; require() throws ERR_REQUIRE_ESM in Node 20 / Electron 32.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const pdfjs: any = await new Function('return import("pdfjs-dist/legacy/build/pdf.mjs")')()
  const buffer = readFileSync(filePath)
  const data = new Uint8Array(buffer)
  const doc = await pdfjs.getDocument({ data }).promise
  const all: PdfItem[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    for (const item of (content.items as Array<{ str: string; transform: number[] }>)) {
      if (item.str.trim()) {
        all.push({
          str: item.str.trim(),
          x: Math.round(item.transform[4]),
          y: Math.round(item.transform[5]),
        })
      }
    }
  }
  return all
}

/** Find value in the same column as a label, in the row directly below it. */
function colBelow(items: PdfItem[], labelStr: string, xTol = 40, yRange = 35): string | null {
  const label = items.find(it => it.str === labelStr)
  if (!label) return null
  const cands = items.filter(it =>
    it.str !== labelStr &&
    Math.abs(it.x - label.x) <= xTol &&
    it.y < label.y &&
    it.y >= label.y - yRange,
  )
  if (cands.length === 0) return null
  return cands.sort((a, b) => b.y - a.y)[0].str
}

const SINGLE_LETTER_COUNTRY: Record<string, string> = {
  F: 'FR', D: 'DE', I: 'IT', E: 'ES', A: 'AT', B: 'BE', P: 'PT', S: 'SE',
  N: 'NO', H: 'HU', L: 'LU',
}

function parseSingleLetterCountry(code: string): string | null {
  const up = code.toUpperCase()
  return SINGLE_LETTER_COUNTRY[up] ?? (up.length === 2 ? up : null)
}

export function extractAngebotnummer(filename: string): string | null {
  const m = filename.match(/(\d+)\.pdf$/i)
  return m ? m[1] : null
}

export async function extractRechnungData(filePath: string): Promise<RechnungData> {
  const empty: RechnungData = {
    positions: [], nettoTotal: null, bruttoTotal: null,
    tagespreisNr: null, bruttoAmount: null,
  }
  try {
    const items = await extractPdfItems(filePath)
    const text = items.map(it => it.str).join(' ')

    // ── Per-position Positionsendbetrag ──────────────────────────
    const posEndAmounts: number[] = []
    for (const m of text.matchAll(/Positionsendbetrag:\s*([\d.]*\d,\d{2})/g)) {
      const n = parseFloat(m[1].replace(/\./g, '').replace(',', '.'))
      if (!isNaN(n)) posEndAmounts.push(n)
    }

    // ── Tagespreis-Nr. (one per position, may be absent) ─────────
    const tagespreisNrs: string[] = []
    for (const m of text.matchAll(/Tagespreis-Nr\.?\s*(\d+)/gi))
      tagespreisNrs.push(m[1].replace(/^0+/, '') || '0')

    // ── "XXXXX / RSWYYY-Z" → aufNr + RSW (DACHSER SUMMENRECHNUNG) ─
    const aufNrs: string[] = []
    const rswCodes: string[] = []
    for (const m of text.matchAll(/(\d+)\s*\/\s*(RSW[A-Z0-9\-]+)/gi)) {
      aufNrs.push(m[1])
      rswCodes.push(m[2].toUpperCase())
    }
    // Supplement: also look for RSW codes in Pickup#/Ref. fields (always, not just as fallback)
    {
      const seen = new Set<string>(rswCodes)
      for (const m of text.matchAll(/(?:Ref\.\s*|PICKUP#\s*)(RSW[A-Z0-9\-]+)/gi)) {
        const code = m[1].toUpperCase()
        if (!seen.has(code)) { seen.add(code); rswCodes.push(code) }
      }
      // Broadest fallback: any standalone RSW token not yet captured
      for (const m of text.matchAll(/\b(RSW[A-Z0-9][\w\-]*)/gi)) {
        const code = m[1].toUpperCase()
        if (!seen.has(code)) { seen.add(code); rswCodes.push(code) }
      }
    }

    // ── Recipient address: single-letter country code + postal code ──
    // Matches patterns like "I   31050   PONZANO" → IT, 31050
    const addrPairs: Array<{ countryCode: string; postalCode: string }> = []
    for (const m of text.matchAll(/(?<![A-Z])([A-Z])(?![A-Z])\s+(\d{4,5})(?!\d)/g)) {
      const cc = SINGLE_LETTER_COUNTRY[m[1]]
      if (cc) addrPairs.push({ countryCode: cc, postalCode: m[2] })
    }

    const posCount = Math.max(posEndAmounts.length, tagespreisNrs.length, aufNrs.length, rswCodes.length, 1)
    const positions: RechnungPosition[] = []
    for (let i = 0; i < posCount; i++) {
      positions.push({
        aufNr:           aufNrs[i]        ?? null,
        tagespreisNr:    tagespreisNrs[i] ?? null,
        rswCode:         rswCodes[i]      ?? null,
        nettoAmount:     posEndAmounts[i] ?? null,
        destCountryCode: addrPairs[i]?.countryCode ?? null,
        destPostalCode:  addrPairs[i]?.postalCode  ?? null,
      })
    }

    // ── Netto total: last "Netto xxx,xx" in text ─────────────────
    let nettoTotal: number | null = null
    const nettoMatches = [...text.matchAll(/\bNetto\b\s+([\d.]*\d,\d{2})/g)]
    if (nettoMatches.length) {
      const n = parseFloat(nettoMatches[nettoMatches.length - 1][1].replace(/\./g, '').replace(',', '.'))
      if (!isNaN(n)) nettoTotal = n
    }

    // ── Brutto total: value just before "Dem Belegempf" ──────────
    let bruttoTotal: number | null = null
    const bm = text.match(/([\d.]*\d,\d{2})\s+Dem\s+Belegempf/)
    if (bm) {
      const n = parseFloat(bm[1].replace(/\./g, '').replace(',', '.'))
      if (!isNaN(n)) bruttoTotal = n
    }

    return {
      positions,
      nettoTotal,
      bruttoTotal,
      tagespreisNr: positions[0]?.aufNr ?? positions[0]?.tagespreisNr ?? null,
      bruttoAmount: bruttoTotal !== null ? bruttoTotal.toFixed(2).replace('.', ',') : null,
    }
  } catch {
    return empty
  }
}

export async function extractPreisangebotData(filePath: string): Promise<PreisangebotData> {
  const angebotnummer = extractAngebotnummer(filePath)
  try {
    const items = await extractPdfItems(filePath)
    const text = items.map(it => it.str).join(' ')

    // ── Amount ──────────────────────────────────────────────────────
    const amtMatch =
      text.match(/Gesamtpreis[^,\d]*([\d.]*\d,\d{2})/i) ??
      text.match(/Gesamtbetrag[^,\d]*([\d.]*\d,\d{2})/i) ??
      text.match(/\bGesamt:[^,\d]*([\d.]*\d,\d{2})/i)
    let amount: number | null = null
    if (amtMatch) {
      const n = parseFloat(amtMatch[1].replace(/\./g, '').replace(',', '.'))
      if (!isNaN(n)) amount = n
    }

    // ── Gefahrgut ───────────────────────────────────────────────────
    // Coordinate-based: find "Gefahrgut" label, then nearby "Ja"/"Nein"
    let gefahrgut: boolean | null = null
    const ggLabel = items.find(it => it.str === 'Gefahrgut')
    if (ggLabel) {
      const ggVal = items.find(it =>
        Math.abs(it.x - ggLabel.x) <= 20 &&
        Math.abs(it.y - ggLabel.y) <= 30 &&
        (it.str === 'Ja' || it.str === 'Nein'),
      )
      if (ggVal) gefahrgut = ggVal.str === 'Ja'
    }
    if (gefahrgut === null) {
      const m = text.match(/(Ja|Nein)\s+Gefahrgut/i) ?? text.match(/Gefahrgut\s+(Ja|Nein)/i)
      if (m) gefahrgut = m[1].toLowerCase() === 'ja'
    }

    // ── Destination ─────────────────────────────────────────────────
    // "Empfänger" label and destination text share the same y-row
    let destCountryCode: string | null = null
    let destZip: string | null = null
    let destCity: string | null = null
    const empf = items.find(it => it.str === 'Empfänger')
    if (empf) {
      const sameRow = items
        .filter(it => Math.abs(it.y - empf.y) <= 5 && it.x > empf.x)
        .sort((a, b) => a.x - b.x)
      const destStr = sameRow.map(it => it.str).join(' ').trim()
      // "F 31120 GOYRANS" or "FR-31120 GOYRANS" or "FR 31120 GOYRANS"
      const m = destStr.match(/^([A-Z]{1,2})\s+(\d{4,5})\s+(.+)$/)
      if (m) {
        destCountryCode = parseSingleLetterCountry(m[1])
        destZip = m[2]
        destCity = m[3].trim()
      }
    }
    // Fallback: "VENLO <code> <zip>" route line
    if (!destCountryCode) {
      const rm = text.match(/VENLO\s+([A-Z]{1,2})\s+(\d{4,5})/)
      if (rm) {
        destCountryCode = parseSingleLetterCountry(rm[1])
        destZip = rm[2]
      }
    }

    // ── Pallets (Menge) ─────────────────────────────────────────────
    const mengeVal = colBelow(items, 'Menge', 30, 30)
    const pallets = mengeVal ? (parseInt(mengeVal) || null) : null

    // ── Volume (Cbm) ────────────────────────────────────────────────
    const cbmVal = colBelow(items, 'Cbm', 30, 30)
    let volume: number | null = null
    if (cbmVal) {
      const v = parseFloat(cbmVal.replace(',', '.'))
      if (!isNaN(v)) volume = v
    }

    // ── Weight (Realgewicht) ─────────────────────────────────────────
    const rgLabel = items.find(it => it.str.startsWith('Realgewicht'))
    let weight: number | null = null
    if (rgLabel) {
      const rgVal = items.find(it =>
        Math.abs(it.x - rgLabel.x) <= 50 &&
        it.y < rgLabel.y &&
        it.y >= rgLabel.y - 30 &&
        /^\d+/.test(it.str),
      )
      if (rgVal) {
        const w = parseInt(rgVal.str.replace(/[^0-9]/g, ''))
        if (!isNaN(w) && w > 0) weight = w
      }
    }

    return { angebotnummer, amount, gefahrgut, destCountryCode, destZip, destCity, pallets, volume, weight }
  } catch {
    return {
      angebotnummer, amount: null, gefahrgut: null,
      destCountryCode: null, destZip: null, destCity: null,
      pallets: null, volume: null, weight: null,
    }
  }
}

// ── PL (Packing List) parser ──────────────────────────────────────

const COUNTRY_NAME_TO_ISO: Record<string, string> = {
  'poland': 'PL', 'germany': 'DE', 'deutschland': 'DE', 'france': 'FR',
  'italy': 'IT', 'spain': 'ES', 'netherlands': 'NL', 'nederland': 'NL',
  'austria': 'AT', 'belgium': 'BE', 'switzerland': 'CH',
  'czech republic': 'CZ', 'czechia': 'CZ', 'hungary': 'HU',
  'romania': 'RO', 'sweden': 'SE', 'denmark': 'DK', 'norway': 'NO',
  'finland': 'FI', 'portugal': 'PT', 'greece': 'GR', 'croatia': 'HR',
  'slovenia': 'SI', 'slovakia': 'SK', 'bulgaria': 'BG',
  'united kingdom': 'GB', 'turkey': 'TR',
}

function countryNameToIso(name: string): string {
  const lower = name.toLowerCase().trim()
  if (lower.length === 2) return lower.toUpperCase()
  return COUNTRY_NAME_TO_ISO[lower] ?? ''
}

export async function parsePlPdf(filePath: string): Promise<PlData> {
  try {
    const items = await extractPdfItems(filePath)
    const text = items.map(it => it.str).join(' ')

    // Company: between "Company:" and "NO.:"
    let company = ''
    const companyMatch = text.match(/Company:\s+(.*?)\s+NO\.\s*:/i)
    if (companyMatch) company = companyMatch[1].replace(/\s+/g, ' ').trim()

    // Contact: between "Contact:" and "PO NO." or "TEL:"
    let contact = ''
    const contactMatch = text.match(/Contact:\s+([\w\s\-\.]+?)(?=\s+(?:PO NO\.|TEL:|VAT))/i)
    if (contactMatch) contact = contactMatch[1].trim()

    // Address: prefer "Delivery address:", fallback to "Address:" after "Company:"
    let street = '', plz = '', ort = '', nkz = ''
    const deliveryMatch = text.match(/Delivery\s+address:\s+(.*?)(?=\s*(?:Packing Conditions|$))/i)
    let rawAddr = deliveryMatch ? deliveryMatch[1].trim() : ''
    if (!rawAddr) {
      const companyIdx = text.search(/Company:/i)
      if (companyIdx >= 0) {
        const m = text.slice(companyIdx).match(/Address:\s+(.*?)(?=\s+(?:DATE:|Contact:|TEL:|PO NO\.))/i)
        if (m) rawAddr = m[1].trim()
      }
    }
    if (rawAddr) {
      const parts = rawAddr.split(',').map(s => s.trim())
      if (parts.length >= 3) {
        street = parts[0]
        const plzCity = parts[1].match(/^(\S+)\s+(.+)$/)
        if (plzCity) { plz = plzCity[1]; ort = plzCity[2] }
        nkz = countryNameToIso(parts[parts.length - 1])
      } else if (parts.length === 2) {
        street = parts[0]
        const rest = parts[1].match(/^(\S+)\s+(\S+)(?:\s+(.+))?$/)
        if (rest) { plz = rest[1]; ort = rest[2]; if (rest[3]) nkz = countryNameToIso(rest[3]) }
      }
    }

    // TEL (may use fullwidth colon ：)
    let tel = ''
    const telMatch = text.match(/TEL[：:]\s*([\d\s\+\-\(\)]+)/i)
    if (telMatch) tel = telMatch[1].trim()

    return { company, contact, street, plz, ort, nkz, tel }
  } catch {
    return { company: '', contact: '', street: '', plz: '', ort: '', nkz: '', tel: '' }
  }
}

// ── Auftrag fill via pymupdf (Python subprocess) ──────────────────

const FILL_SCRIPT = `# -*- coding: utf-8 -*-
import sys, json, fitz

data = json.loads(sys.stdin.read())
template = sys.argv[1]
output = sys.argv[2]

fill_map = {
    "Absender Name 1": data.get("absenderName", ""),
    "Absender Straße": data.get("absenderStrasse", ""),
    "Empfänger Name 1": data.get("empfaengerName", ""),
    "Empfänger Abteilung, Produktionsstätte": data.get("empfaengerKontakt", ""),
    "Empfänger Straße": data.get("empfaengerStrasse", ""),
    "Zustelloptionen 4": data.get("telefon", ""),
}

try:
    doc = fitz.open(template)
    page = doc[0]
    pre_filled = {}
    for widget in page.widgets():
        name = widget.field_name
        if name in ["Empfänger NKZ", "Empfänger PLZ", "Empfänger Ort"]:
            pre_filled[name] = (widget.field_value or "").strip()
        if name in fill_map and fill_map[name]:
            widget.field_value = fill_map[name]
            widget.update()
    doc.save(output)
    doc.close()
    warnings = []
    checks = [
        ("Empfänger NKZ", pre_filled.get("Empfänger NKZ", ""), data.get("plNkz", "")),
        ("Empfänger PLZ", pre_filled.get("Empfänger PLZ", ""), data.get("plPlz", "")),
        ("Empfänger Ort", pre_filled.get("Empfänger Ort", ""), data.get("plOrt", "")),
    ]
    for field, auftrag_val, pl_val in checks:
        if pl_val and auftrag_val.upper() != pl_val.upper():
            warnings.append(f"{field}: Auftrag '{auftrag_val}' != PL '{pl_val}'")
    print(json.dumps({"ok": True, "warnings": warnings}))
except Exception as e:
    print(json.dumps({"ok": False, "error": str(e)}))
`

interface AuftragFillInput {
  absenderName: string
  absenderStrasse: string
  empfaengerName: string
  empfaengerKontakt: string
  empfaengerStrasse: string
  telefon: string
  plNkz: string
  plPlz: string
  plOrt: string
}

function runFillScript(
  input: AuftragFillInput,
  templatePath: string,
  outputPath: string,
): Promise<{ ok: boolean; error?: string; warnings?: string[] }> {
  return new Promise((resolve) => {
    const scriptPath = join(tmpdir(), `logianfrage_fill_${Date.now()}.py`)
    try { writeFileSync(scriptPath, FILL_SCRIPT, 'utf-8') } catch (e) {
      return resolve({ ok: false, error: `无法写入临时脚本: ${e}` })
    }

    const pathEnv = [
      '/opt/homebrew/bin',
      '/opt/homebrew/opt/python@3.14/bin',
      '/usr/local/bin',
      process.env.PATH ?? '',
    ].join(':')

    const child = spawn('python3', [scriptPath, templatePath, outputPath], {
      env: { ...process.env, PATH: pathEnv },
    })

    let stdout = '', stderr = ''
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    child.stdin.write(JSON.stringify(input))
    child.stdin.end()

    child.on('close', (code) => {
      try { unlinkSync(scriptPath) } catch { /* ignore */ }
      if (code !== 0) {
        resolve({ ok: false, error: stderr.trim() || `Python 退出码 ${code}` })
        return
      }
      try {
        const r = JSON.parse(stdout.trim())
        resolve({ ok: r.ok ?? true, error: r.error, warnings: r.warnings ?? [] })
      } catch {
        resolve({ ok: false, error: `无法解析输出: ${stdout.slice(0, 200)}` })
      }
    })
    child.on('error', (err) => {
      try { unlinkSync(scriptPath) } catch { /* ignore */ }
      resolve({ ok: false, error: `无法启动 python3: ${err.message}` })
    })
  })
}

export async function fillSpeditionsauftrag(
  _templatePath: string,
  _data: SpeditionsauftragData,
  _outputPath: string,
): Promise<{ ok: boolean; error?: string }> {
  return { ok: false, error: '请使用"填写Auftrag"功能（通过 fill-auftrag-from-pl）' }
}

export async function fillAuftragFromPl(params: {
  templatePath: string
  plData: PlData
  recordType: string
  outputPath: string
}): Promise<{ ok: boolean; error?: string; warnings?: string[] }> {
  const { templatePath, plData, recordType, outputPath } = params
  const input: AuftragFillInput = {
    absenderName: 'Radtec B.V.',
    absenderStrasse: recordType === 'BATT' ? 'Ankerkade 18' : 'Celsiusweg 66',
    empfaengerName: plData.company,
    empfaengerKontakt: plData.contact,
    empfaengerStrasse: plData.street,
    telefon: plData.tel,
    plNkz: plData.nkz,
    plPlz: plData.plz,
    plOrt: plData.ort,
  }
  return runFillScript(input, templatePath, outputPath)
}
