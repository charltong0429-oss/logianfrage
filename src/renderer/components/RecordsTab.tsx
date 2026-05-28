import React, { useState, useEffect, useRef, useMemo } from 'react'
import type { ArchiveRecord, NotionRecord, FormData, InquiryStatus } from '../utils/types'
import { INQUIRY_STATUSES } from '../utils/types'
import { buildEmail, INQUIRY_RECIPIENT } from '../utils/emailBuilder'

type MailClient = 'system' | 'webmail'
type RenameItem = { oldPath: string; newPath: string; oldName: string; newName: string }
type NoticeState = { msg: string; isError: boolean; isWarn: boolean } | null

interface Props {
  basePath: string
  mailClient: MailClient
  mailApp: string
  webmailUrl: string
  defaultRecipient?: string
}

const STATUS_COLORS: Record<InquiryStatus, string> = {
  '待询价':    'bg-sky-100 text-sky-700',
  '已询价':    'bg-blue-100 text-blue-700',
  '已报价':    'bg-indigo-100 text-indigo-700',
  '要求出货':  'bg-amber-100 text-amber-700',
  '已要求出货':'bg-orange-100 text-orange-700',
  '已要求提货':'bg-orange-100 text-orange-700',
  '已收账单':  'bg-purple-100 text-purple-700',
}

// ── Status ordering ───────────────────────────────────────────────

const STATUS_ORDER: Record<InquiryStatus, number> = {
  '待询价': 0, '已询价': 1, '已报价': 2, '要求出货': 3, '已要求出货': 4, '已要求提货': 4, '已收账单': 5,
}

// ── Calibration helper ────────────────────────────────────────────

type CalItem = {
  record: ArchiveRecord
  newStatus: InquiryStatus
  angebotnummer: string | null
  rswCode: string | null
  folderPath: string | null  // set when discovered via secondary match
  preisFilePaths: string[]   // all Preisangebot PDFs in the folder (may be >1 for multi-order folders)
}

function deriveStatusFromFolder(
  folderName: string | null,
  files: string[],
): { status: InquiryStatus; angebotnummer: string | null; rswCode: string | null; preisFile: string | null } {
  const lower = files.map((f) => f.toLowerCase())

  const rswMatch = (folderName ?? '').match(/RSW\d+-[A-Z]/i)
  const rswCode = rswMatch ? rswMatch[0].toUpperCase() : null

  let angebotnummer: string | null = null
  const preisFile = files.find((f) => /DACHSER_Preisangebot/i.test(f) && /\.pdf$/i.test(f)) ?? null
  if (preisFile) {
    const m = preisFile.match(/(\d+)\.pdf$/i)
    if (m) angebotnummer = m[1]
  }

  // Speditionsauftrag received from DACHSER is an UNFILLED template (Empfänger.Straße empty).
  // RSW code in folder name is the true indicator that pickup has been requested.
  const hasRechnung = lower.some((f) => f.includes('rechnung'))
  const hasSped     = lower.some((f) => /speditionsauftrag/i.test(f))
  const hasPreis    = lower.some((f) => /preisangebot/i.test(f))

  if (hasRechnung)         return { status: '已收账单',   angebotnummer, rswCode, preisFile }
  if (rswCode)             return { status: '已要求提货', angebotnummer, rswCode, preisFile }
  if (hasSped || hasPreis) return { status: '已报价',     angebotnummer, rswCode, preisFile }
  return { status: '已询价', angebotnummer, rswCode, preisFile: null }
}

// Derive the minimum status that Notion properties alone imply.
// Used to catch records where data was entered manually in Notion
// but the status was never advanced (e.g. rechnungAmount set but status still 已报价).
function deriveMinStatusFromNotion(r: ArchiveRecord): InquiryStatus | null {
  if (r.rechnungAmount !== null || r.rechnungAmountBrutto !== null) return '已收账单'
  if (r.rswCode !== null) return '要求出货'
  if (r.amount !== null || r.angebotnummer !== null) return '已报价'
  return null
}

// ── Email helper ──────────────────────────────────────────────────

function notionToFormData(r: NotionRecord): FormData {
  const postalCity = [r.postalCode, r.city].filter(Boolean).join(' ')
  return {
    recipient: INQUIRY_RECIPIENT,
    pallets: r.pallets !== null ? String(r.pallets) : '',
    dimensions: r.dimensions ?? (r.volume !== null ? String(r.volume) : ''),
    loadingMeters: r.ldm !== null ? String(r.ldm) : '',
    weight: r.weight !== null ? String(r.weight) : '',
    address1: r.address ?? '',
    address2: postalCity,
    address3: r.country,
    cargoType: r.type,
    hasInsurance: true,
    insuranceAmount: '5000',
  }
}

// ─────────────────────────────────────────────────────────────────

// Convert 2-letter ISO country code to flag emoji
function countryFlag(code: string): string {
  if (!code || code.length !== 2) return ''
  return code.toUpperCase().split('').map(c =>
    String.fromCodePoint(c.charCodeAt(0) + 0x1F1A5)
  ).join('')
}

// ── Toolbar dropdown ──────────────────────────────────────────────

function ToolbarMenu({ loading, bulkExtractProgress, onRefresh, onCalibrate, onBulkExtract, onNormalize }: {
  loading: boolean
  bulkExtractProgress: { done: number; total: number } | null
  onRefresh: () => void
  onCalibrate: () => void
  onBulkExtract: () => void
  onNormalize: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  const items = [
    {
      label: loading ? '加载中…' : '刷新',
      onClick: () => { onRefresh(); setOpen(false) },
      disabled: loading,
      cls: 'text-gray-700',
    },
    {
      label: '校准状态',
      onClick: () => { onCalibrate(); setOpen(false) },
      disabled: false,
      cls: 'text-gray-700',
    },
    {
      label: bulkExtractProgress
        ? `提取中 ${bulkExtractProgress.done}/${bulkExtractProgress.total}…`
        : '批量提取报价',
      onClick: () => { onBulkExtract(); setOpen(false) },
      disabled: !!bulkExtractProgress || loading,
      cls: 'text-gray-700',
      title: '读取所有已报价条目的 Preisangebot PDF，自动填入报价金额（已有金额的跳过）',
    },
    {
      label: '规范化名称',
      onClick: () => { onNormalize(); setOpen(false) },
      disabled: false,
      cls: 'text-gray-700',
    },
  ]

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 px-2 py-1 rounded-md hover:bg-gray-100 transition-colors"
      >
        <span>工具</span>
        <span className="text-[10px] text-gray-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-36 bg-white rounded-lg shadow-lg border border-gray-100 py-1 z-50">
          {items.map((item, i) => (
            <button
              key={i}
              onClick={item.onClick}
              disabled={item.disabled}
              title={item.title}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${item.cls}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const TYPE_BADGE_CLS: Record<string, string> = {
  INV:  'bg-blue-100 text-blue-700',
  BATT: 'bg-orange-100 text-orange-700',
  ACC:  'bg-purple-100 text-purple-700',
}
function typeBadge(type: string) {
  return (
    <span className={`text-[10px] px-1 py-px rounded font-mono font-semibold ${TYPE_BADGE_CLS[type] ?? 'bg-gray-100 text-gray-600'}`}>
      {type}
    </span>
  )
}

export default function RecordsTab({ basePath, mailClient, mailApp, webmailUrl, defaultRecipient }: Props) {
  const [records, setRecords] = useState<ArchiveRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<ArchiveRecord | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [notice, setNotice] = useState<NoticeState>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [emailRecipient, setEmailRecipient] = useState('')
  const [emailBody, setEmailBody] = useState('')

  const [preisDropActive, setPreisDropActive] = useState(false)
  const [plDropActive, setPlDropActive] = useState(false)
  const [rechnungDropActive, setRechnungDropActive] = useState(false)

  const [renamePreview, setRenamePreview] = useState<RenameItem[] | null>(null)
  const [renaming, setRenaming] = useState(false)

  // Calibration state
  const [calPreview, setCalPreview] = useState<CalItem[] | null>(null)
  const [calibrating, setCalibrating] = useState(false)
  const [calProgress, setCalProgress] = useState<{ done: number; total: number; current: string } | null>(null)

  // Accordion: only one month open at a time (null = none)
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const [reInquiryOpen, setReInquiryOpen] = useState(false)

  const LS_PICKUP_ACK = 'liq_pickup_ack_v1'
  const [pickupAckedIds, setPickupAckedIds] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(LS_PICKUP_ACK) ?? '[]')) } catch { return new Set() }
  })
  function markPickupAcked(id: string) {
    setPickupAckedIds(prev => {
      const next = new Set(prev)
      next.add(id)
      try { localStorage.setItem(LS_PICKUP_ACK, JSON.stringify([...next])) } catch { /* ignore */ }
      return next
    })
  }
  const [extractingPrice, setExtractingPrice] = useState(false)
  const [fillingAuftrag, setFillingAuftrag] = useState(false)
  const [bulkExtractProgress, setBulkExtractProgress] = useState<{ done: number; total: number; current: string } | null>(null)

  function showNotice(msg: string, ms = 4000, isError = false, isWarn = false) {
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    setNotice({ msg, isError, isWarn })
    if (!isError && !isWarn) {
      noticeTimer.current = setTimeout(() => setNotice(null), ms)
    }
  }

  // ── Data loading ───────────────────────────────────────────────

  async function loadData() {
    setLoading(true)
    try {
      const notionResult = await window.api.notionFetchRecords()
      if (!notionResult.ok) {
        showNotice(`Notion 加载失败：${notionResult.error ?? '请检查设置'}`, 6000, false, true)
        return
      }

      const folderMap = new Map<string, { folderName: string; files: string[]; romanNumeral: string }>()
      // Secondary match: folders not yet claimed by a Notion folderPath
      const unclaimedFolders: Array<{ folderPath: string; folderName: string; files: string[]; romanNumeral: string; date: string; type: string; country: string }> = []
      if (basePath) {
        try {
          const scanned = await window.api.scanFolders(basePath)
          const claimedPaths = new Set(notionResult.records.map(r => r.folderPath).filter(Boolean))
          for (const r of scanned) {
            if (!r.folderPath) continue
            const entry = {
              folderPath: r.folderPath as string,
              folderName: (r.folderName as string) ?? '',
              files: r.files,
              romanNumeral: r.romanNumeral,
              date: r.date,
              type: r.type,
              country: r.country,
            }
            folderMap.set(r.folderPath as string, entry)
            if (!claimedPaths.has(r.folderPath as string)) unclaimedFolders.push(entry)
          }
        } catch { /* no local access */ }
      }

      const merged: ArchiveRecord[] = notionResult.records.map((nr) => {
        // Primary match: by Notion folderPath
        const local = nr.folderPath ? folderMap.get(nr.folderPath) : undefined
        if (local) return { ...nr, folderName: local.folderName, romanNumeral: local.romanNumeral, files: local.files }

        // Secondary match: by (date, type, country) for records that have no folderPath in Notion
        const idx = unclaimedFolders.findIndex(
          f => f.date === nr.date && f.type === nr.type && f.country === nr.country
        )
        if (idx >= 0) {
          const matched = unclaimedFolders.splice(idx, 1)[0]
          return {
            ...nr,
            folderPath: matched.folderPath,   // update folderPath from discovered folder
            folderName: matched.folderName,
            romanNumeral: matched.romanNumeral,
            files: matched.files,
          }
        }

        return { ...nr, folderName: null, romanNumeral: '', files: [] }
      })

      // Deduplicate: prefer records with folderPath; deduplicate by (date, type, country, folderPath-or-romanNumeral)
      const sortedForDedup = [...merged].sort((a, b) => (b.folderPath ? 1 : 0) - (a.folderPath ? 1 : 0))
      const seenKeys = new Set<string>()
      const deduped = sortedForDedup.filter((r) => {
        const key = r.folderPath
          ? `${r.date}|${r.type}|${r.country}|${r.folderPath}`
          : `${r.date}|${r.type}|${r.country}|${r.romanNumeral}`
        if (seenKeys.has(key)) return false
        seenKeys.add(key)
        return true
      })
      const dupCount = merged.length - deduped.length
      if (dupCount > 0) showNotice(`发现 ${dupCount} 条重复记录（已自动隐藏），建议在 Notion 中手动清理`, 8000, false, true)

      setRecords(deduped)
      // Auto-open newest month on first load
      if (deduped.length > 0) {
        const newest = [...deduped].sort((a, b) => b.date.localeCompare(a.date))[0]
        const ym = newest.date.length >= 7 ? newest.date.slice(0, 7) : null
        if (ym) setOpenGroup(prev => prev ?? ym)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [basePath])

  useEffect(() => {
    if (selected) {
      const updated = records.find((r) => r.notionPageId === selected.notionPageId)
      if (updated) setSelected(updated)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records])

  useEffect(() => {
    if (selected?.status === '待询价') {
      const { body } = buildEmail(notionToFormData(selected))
      setEmailBody(body)
      setEmailRecipient(defaultRecipient || INQUIRY_RECIPIENT)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.notionPageId])

  // ── Notion update helper ──────────────────────────────────────

  async function notionUpdate(params: Parameters<typeof window.api.notionUpdatePage>[0]) {
    const r = await window.api.notionUpdatePage(params)
    if (!r.ok) showNotice(`Notion 更新失败：${r.error ?? '请检查设置'}`, 5000, false, true)
    return r.ok
  }

  // ── Calibration ───────────────────────────────────────────────

  function handleBuildCalibration() {
    const items: CalItem[] = []
    for (const r of records) {
      const hasFolder = !!(r.folderName && r.files.length > 0)

      // Signal 1: derive status from folder files (only when a local folder exists)
      const fileDerived = hasFolder ? deriveStatusFromFolder(r.folderName, r.files) : null

      // Signal 2: derive minimum status from Notion properties alone
      // (catches records where data was manually entered in Notion but status was never advanced)
      const notionMin = deriveMinStatusFromNotion(r)

      const currentOrder  = STATUS_ORDER[r.status] ?? 0
      const fileOrder     = fileDerived ? (STATUS_ORDER[fileDerived.status] ?? 0) : -1
      const notionMinOrder = notionMin ? (STATUS_ORDER[notionMin] ?? 0) : -1

      // Target = whichever signal implies the most advanced status
      const targetOrder = Math.max(fileOrder, notionMinOrder)
      const statusNeedsAdvance = targetOrder > currentOrder

      const angDiffers = fileDerived?.angebotnummer && fileDerived.angebotnummer !== r.angebotnummer
      const rswDiffers = fileDerived?.rswCode && fileDerived.rswCode !== r.rswCode
      const folderPathNew = hasFolder && !!r.folderPath && (statusNeedsAdvance || angDiffers || rswDiffers)

      if (statusNeedsAdvance || angDiffers || rswDiffers) {
        // Pick the winning status: highest-order signal wins
        const newStatus: InquiryStatus =
          notionMinOrder >= fileOrder && notionMin ? notionMin : fileDerived!.status

        const preisFilePaths = r.folderPath
          ? r.files
              .filter(f => /DACHSER_Preisangebot/i.test(f) && /\.pdf$/i.test(f))
              .map(f => `${r.folderPath}/${f}`)
          : []
        items.push({
          record: r,
          newStatus,
          angebotnummer: fileDerived?.angebotnummer ?? null,
          rswCode: fileDerived?.rswCode ?? null,
          folderPath: folderPathNew ? r.folderPath : null,
          preisFilePaths,
        })
      }
    }
    if (items.length === 0) {
      showNotice('所有记录状态已是最新，无需校准')
      return
    }
    setCalPreview(items)
  }

  async function handleConfirmCalibration() {
    if (!calPreview) return
    setCalibrating(true)
    setCalProgress({ done: 0, total: calPreview.length, current: '' })
    let ok = 0, fail = 0
    for (let i = 0; i < calPreview.length; i++) {
      const item = calPreview[i]
      setCalProgress({ done: i, total: calPreview.length, current: recordLabel(item.record) })
      const params: Parameters<typeof window.api.notionUpdatePage>[0] = {
        pageId: item.record.notionPageId,
        status: item.newStatus,
      }
      if (item.angebotnummer && item.angebotnummer !== item.record.angebotnummer)
        params.angebotnummer = item.angebotnummer
      if (item.rswCode && item.rswCode !== item.record.rswCode)
        params.rswCode = item.rswCode
      if (item.folderPath)
        params.folderPath = item.folderPath
      if (item.preisFilePaths.length > 0 && item.record.amount === null) {
        try {
          let total = 0, anyFound = false
          for (const fp of item.preisFilePaths) {
            const pdfResult = await window.api.parsePreisangebotPdf(fp)
            if (pdfResult.amount !== null) { total += pdfResult.amount; anyFound = true }
          }
          if (anyFound) params.amount = total
        } catch { /* non-blocking */ }
      }
      const success = await notionUpdate(params)
      if (success) ok++; else fail++
    }
    setCalProgress({ done: calPreview.length, total: calPreview.length, current: '完成' })
    await new Promise(r => setTimeout(r, 400))
    setCalibrating(false)
    setCalProgress(null)
    setCalPreview(null)
    showNotice(`校准完成：${ok} 条更新成功${fail > 0 ? `，${fail} 条失败` : ''}`, 5000, fail > 0, false)
    await loadData()
  }

  // ── Status action handlers ────────────────────────────────────

  async function handleSendEmail() {
    if (!selected) return
    const { subject } = buildEmail(notionToFormData(selected))
    const recipient = emailRecipient.trim()

    if (mailClient === 'webmail' && webmailUrl) {
      await window.api.copyToClipboard(emailBody)
      await window.api.openUrl(webmailUrl)
      showNotice('正文已复制到剪贴板，请在网页邮件中粘贴')
      return
    }

    // 不把 body 写入 mailto，让 AliMail 添加默认签名；正文单独复制到剪贴板
    const mailto = `mailto:${recipient}?subject=${encodeURIComponent(subject)}`
    await window.api.copyToClipboard(emailBody)
    const mailAppName = mailApp || 'AliMail'
    const result = await window.api.openWithMailApp(mailAppName, mailto)
    if (!result.ok) await window.api.openUrl(mailto)
    showNotice('正文已复制到剪贴板 → 在签名前粘贴（Cmd+V）')
  }

  async function handleSendPickupEmail(r: ArchiveRecord) {
    if (!r.rswCode) return
    const isBatt = r.type === 'BATT'
    const body = [
      'Hello,',
      '',
      'Please proceed as enclosed Auftrag.',
      `The Pickup # is ${r.rswCode}`,
      ...(isBatt ? [
        'Die Sendung beinhaltet Gefahrgut.',
        'GG-Gewicht ',
        'UN3480',
        'Verpackungsklasse 9 2E',
      ] : []),
      '',
      'Packing list attached.',
      'BR',
      '____',
    ].join('\n')

    const subject = r.angebotnummer
      ? `AW: DACHSER Preisangebot ${r.angebotnummer}`
      : `Pickup Request — ${r.date} ${r.type} ${r.country}`

    const auftragFile = r.files.find(f => /Speditionsauftrag|Auftrag/i.test(f) && /\.pdf$/i.test(f))
    const attachments: { path: string; filename: string }[] = auftragFile && r.folderPath
      ? [{ path: `${r.folderPath}/${auftragFile}`, filename: auftragFile }]
      : []

    const recipient = defaultRecipient || INQUIRY_RECIPIENT

    if (mailClient === 'webmail' && webmailUrl) {
      await window.api.copyToClipboard(body)
      await window.api.openUrl(webmailUrl)
      showNotice(`正文已复制${attachments.length ? '' : '（⚠️ 请手动附上 Speditionsauftrag）'}`)
      return
    }

    const res = await window.api.emailSendSaved({ to: recipient, subject, body, attachments })
    if (res.ok) {
      showNotice(`提货邮件已发送${attachments.length ? `（附件：${attachments[0].filename}）` : ''}`)
    } else {
      showNotice(`发送失败：${res.error ?? '请检查邮件设置'}`, 6000, false, true)
    }
  }

  async function handleMarkStatus(status: InquiryStatus) {
    if (!selected) return
    const ok = await notionUpdate({ pageId: selected.notionPageId, status })
    if (ok) { showNotice(`状态已更新：${status}`); await loadData() }
  }

  async function handleMarkInquirySent() {
    if (!selected) return
    let folderPath = selected.folderPath
    if (!folderPath) {
      if (!basePath) { showNotice('请先在设置中配置档案路径', 5000, false, true); return }
      const cr = await window.api.createArchiveFolder({
        basePath, date: selected.date, type: selected.type, country: selected.country,
      })
      if (!cr.ok || !cr.folderPath) { showNotice(`创建文件夹失败：${cr.error}`, 5000, true); return }
      folderPath = cr.folderPath
      const meta = {
        notionPageId: selected.notionPageId,
        angebotnummer: null,
        pickupNr: null,
        type: selected.type,
        country: selected.country,
        date: selected.date,
      }
      await window.api.writeFolderMeta({ folderPath, meta })
    }
    const ok = await notionUpdate({ pageId: selected.notionPageId, status: '已询价', folderPath })
    if (ok) { showNotice('文件夹已创建，状态更新：已询价'); await loadData() }
  }

  async function handleExtractPrice(r: ArchiveRecord) {
    const preisFiles = r.files.filter(f => /DACHSER_Preisangebot/i.test(f) && /\.pdf$/i.test(f))
    if (preisFiles.length === 0 || !r.folderPath) return
    setExtractingPrice(true)
    try {
      let total = 0, anyFound = false
      for (const f of preisFiles) {
        const result = await window.api.parsePreisangebotPdf(`${r.folderPath}/${f}`)
        if (result.amount !== null) { total += result.amount; anyFound = true }
      }
      if (!anyFound) { showNotice('PDF 中未找到金额，请通过文件导入区域拖入 PDF', 5000, false, true); return }
      const ok = await notionUpdate({ pageId: r.notionPageId, amount: total })
      if (ok) {
        const suffix = preisFiles.length > 1 ? `（${preisFiles.length} 个 PDF 合计）` : ''
        showNotice(`报价金额已更新：€ ${total.toLocaleString('de-DE', { minimumFractionDigits: 2 })}${suffix}`)
        await loadData()
      }
    } finally {
      setExtractingPrice(false)
    }
  }

  async function handleFillAuftrag(r: ArchiveRecord) {
    if (!r.folderPath) return
    setFillingAuftrag(true)
    try {
      const result = await window.api.fillAuftragFromPl({ folderPath: r.folderPath, recordType: r.type })
      if (!result.ok) {
        showNotice(`填写失败：${result.error}`, 6000, true)
        return
      }
      const warnings = result.warnings ?? []
      const base = `Auftrag 已填写 → ${result.outputFile}`
      if (warnings.length > 0) {
        showNotice(`${base}\n⚠️ 验证警告：${warnings.join('；')}`, 10000, false, true)
      } else {
        showNotice(base)
      }
      await loadData()
    } finally {
      setFillingAuftrag(false)
    }
  }

  async function handleBulkExtractPrices() {
    const targets = records.filter(r =>
      r.status === '已报价' &&
      r.amount === null &&
      r.folderPath !== null &&
      r.files.some(f => /DACHSER_Preisangebot/i.test(f) && /\.pdf$/i.test(f))
    )
    if (targets.length === 0) {
      showNotice('所有已报价条目均已有报价金额，无需批量提取')
      return
    }
    setBulkExtractProgress({ done: 0, total: targets.length, current: '' })
    let ok = 0, fail = 0, notFound = 0
    for (let i = 0; i < targets.length; i++) {
      const r = targets[i]
      setBulkExtractProgress({ done: i, total: targets.length, current: recordLabel(r) })
      const preisFiles = r.files.filter(f => /DACHSER_Preisangebot/i.test(f) && /\.pdf$/i.test(f))
      try {
        let total = 0, anyFound = false
        for (const f of preisFiles) {
          const result = await window.api.parsePreisangebotPdf(`${r.folderPath}/${f}`)
          if (result.amount !== null) { total += result.amount; anyFound = true }
        }
        if (anyFound) {
          const success = await notionUpdate({ pageId: r.notionPageId, amount: total })
          if (success) ok++; else fail++
        } else {
          notFound++
        }
      } catch { fail++ }
    }
    setBulkExtractProgress(null)
    const parts = [`成功 ${ok} 条`]
    if (notFound > 0) parts.push(`${notFound} 条未解析到金额`)
    if (fail > 0) parts.push(`${fail} 条更新失败`)
    showNotice(`批量提取完成：${parts.join('，')}`, 6000, fail > 0, notFound > 0)
    await loadData()
  }

  async function handlePreisDrop(e: React.DragEvent) {
    e.preventDefault()
    setPreisDropActive(false)
    if (!selected) return

    const droppedFiles = Array.from(e.dataTransfer.files)
    if (droppedFiles.length === 0) return
    const srcPaths = droppedFiles.map((f) => window.api.getDroppedFilePath(f))

    const preisFile = droppedFiles.find((f) => /preisangebot/i.test(f.name))
    let angebotnummer: string | null = null
    if (preisFile) {
      const r = await window.api.extractAngebotnummer(preisFile.name)
      angebotnummer = r.angebotnummer
    }

    let amount: number | null = null
    if (preisFile) {
      const r = await window.api.parsePreisangebotPdf(window.api.getDroppedFilePath(preisFile))
      amount = r.amount
    }

    let folderPath: string = selected.folderPath ?? ''
    if (!folderPath) {
      if (!basePath) { showNotice('请先在设置中配置档案路径', 5000, false, true); return }
      const cr = await window.api.createArchiveFolder({
        basePath, date: selected.date, type: selected.type, country: selected.country,
      })
      if (!cr.ok || !cr.folderPath) { showNotice(`创建文件夹失败：${cr.error}`, 5000, true); return }
      folderPath = cr.folderPath
    }

    const moveResult = await window.api.moveFilesToFolder({ srcPaths, destFolderPath: folderPath })
    if (!moveResult.ok) { showNotice(`文件移动失败：${moveResult.error}`, 5000, true); return }

    let finalPath = folderPath
    if (angebotnummer) {
      const rr = await window.api.renameFolderAppend({ currentPath: folderPath, suffix: angebotnummer })
      if (rr.ok && rr.newPath) finalPath = rr.newPath
    }

    const meta = await window.api.readFolderMeta(finalPath)
    const updatedMeta = meta
      ? { ...meta, angebotnummer: angebotnummer ?? meta.angebotnummer, notionPageId: selected.notionPageId }
      : { notionPageId: selected.notionPageId, angebotnummer, pickupNr: null, type: selected.type, country: selected.country, date: selected.date }
    await window.api.writeFolderMeta({ folderPath: finalPath, meta: updatedMeta })

    await notionUpdate({
      pageId: selected.notionPageId,
      status: '已报价',
      folderPath: finalPath,
      ...(angebotnummer ? { angebotnummer } : {}),
      ...(amount !== null ? { amount } : {}),
    })

    showNotice(`报价文件已归入${angebotnummer ? ` (${angebotnummer})` : ''}，状态更新：已报价`)
    await loadData()
  }

  async function handlePlDrop(e: React.DragEvent) {
    e.preventDefault()
    setPlDropActive(false)
    if (!selected?.folderPath) return
    const droppedFiles = Array.from(e.dataTransfer.files)
    if (droppedFiles.length === 0) return
    const srcPaths = droppedFiles.map((f) => window.api.getDroppedFilePath(f))
    const result = await window.api.moveFilesToFolder({ srcPaths, destFolderPath: selected.folderPath })
    if (!result.ok) { showNotice(`PL 文件移动失败：${result.error}`, 5000, true) }
    else { showNotice('PL 文件已移入'); await loadData() }
  }

  async function handleRechnungDrop(e: React.DragEvent) {
    e.preventDefault()
    setRechnungDropActive(false)
    if (!selected) return
    const droppedFiles = Array.from(e.dataTransfer.files)
    if (droppedFiles.length === 0) return
    const filePath = window.api.getDroppedFilePath(droppedFiles[0])

    const pdfData = await window.api.parseRechnungPdf(filePath)

    type MatchResult = { record: ArchiveRecord; nettoAmount: number | null; matchedBy: string }
    const matches: MatchResult[] = []
    const seenIds = new Set<string>()

    const addMatch = (record: ArchiveRecord, nettoAmount: number | null, matchedBy: string) => {
      if (!seenIds.has(record.notionPageId) && record.folderPath) {
        matches.push({ record, nettoAmount, matchedBy })
        seenIds.add(record.notionPageId)
      }
    }

    for (let i = 0; i < Math.max(pdfData.positions.length, 1); i++) {
      const pos = pdfData.positions[i]

      // Priority 1: Pickup# (RSW code) — most reliable identifier
      // Check both Notion rswCode field AND folder name (Notion may not be synced yet)
      if (pos?.rswCode) {
        const rsw = pos.rswCode.toUpperCase()
        const hit = records.find(r =>
          r.rswCode?.toUpperCase() === rsw ||
          r.folderName?.toUpperCase().includes(rsw)
        )
        if (hit) { addMatch(hit, pos.nettoAmount, `Pickup# ${pos.rswCode}`); continue }
      }

      // Priority 2: Tagespreis-Nr. or Auf-Nr. → findFolderByNr
      const nr = pos?.tagespreisNr ?? pos?.aufNr
      if (nr && basePath) {
        const foundPath = await window.api.findFolderByNr({ basePath, angebotnummer: nr })
        if (foundPath) {
          const hit = records.find(r => r.folderPath === foundPath)
          if (hit) { addMatch(hit, pos?.nettoAmount ?? null, `Tagespreis-Nr. ${nr}`); continue }
        }
      }

      // Priority 3: Country code + postal code → match record
      if (pos?.destPostalCode && pos?.destCountryCode) {
        const hit = records.find(r =>
          r.postalCode === pos.destPostalCode && r.country === pos.destCountryCode
        )
        if (hit) { addMatch(hit, pos.nettoAmount, `${pos.destCountryCode} ${pos.destPostalCode}`); continue }
      }

      // Fallback: selected record (for the first unmatched position)
      if (i === 0 && selected.folderPath) {
        addMatch(selected, pos?.nettoAmount ?? null, '当前选中')
      }
    }

    if (matches.length === 0) {
      showNotice('无法确定目标文件夹，请确认本地文件夹已创建', 5000, true)
      return
    }

    // Copy PDF into every matched folder (same invoice → multiple folders)
    const destFolderPaths = matches.map(m => m.record.folderPath!)
    const copyResult = await window.api.copyFileToFolders({ srcPath: filePath, destFolderPaths })
    if (!copyResult.ok) {
      showNotice(`文件复制失败：${copyResult.error}`, 5000, true)
      return
    }

    // Update Notion for each matched record
    for (const match of matches) {
      await notionUpdate({
        pageId: match.record.notionPageId,
        status: '已收账单',
        folderPath: match.record.folderPath,
        ...(match.nettoAmount !== null ? { rechnungAmount: match.nettoAmount } : {}),
        // Only write brutto total when this is the sole record on this invoice
        ...(pdfData.bruttoTotal !== null && matches.length === 1 ? { rechnungAmountBrutto: pdfData.bruttoTotal } : {}),
      })
    }

    const summary = matches.map(m => m.matchedBy).join('、')
    showNotice(
      `Rechnung 已归入 ${matches.length} 个文件夹（${summary}）${pdfData.bruttoAmount ? `，总额 ${pdfData.bruttoAmount} EUR` : ''}，状态更新：已收账单`,
      8000,
    )
    await loadData()
  }

  async function handlePlanRenames() {
    if (!basePath) { showNotice('未配置档案路径', 4000, true); return }
    const items = await window.api.planFolderRenames(basePath)
    if (items.length === 0) { showNotice('所有文件夹名已符合标准格式') }
    else { setRenamePreview(items) }
  }

  async function handleExecuteRenames() {
    if (!renamePreview) return
    setRenaming(true)
    const result = await window.api.executeFolderRenames(renamePreview)
    setRenaming(false)
    setRenamePreview(null)
    showNotice(
      result.errors.length > 0
        ? `重命名：${result.renamed} 成功，${result.errors.length} 失败`
        : `已重命名 ${result.renamed} 个文件夹`,
      6000, false, result.errors.length > 0
    )
    loadData()
  }

  // ── Derived state ─────────────────────────────────────────────

  const filteredRecords = useMemo(
    () => statusFilter === 'all' ? records : records.filter((r) => r.status === statusFilter),
    [records, statusFilter],
  )

  // Status counts from ALL records (for filter pills, unaffected by active filter)
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const r of records) {
      const k = r.status || '未知'
      counts[k] = (counts[k] ?? 0) + 1
    }
    return counts
  }, [records])

  // Records grouped by year-month, sorted newest → oldest
  const byYearMonth = useMemo(() => {
    const sorted = [...filteredRecords].sort((a, b) => b.date.localeCompare(a.date))
    const map = new Map<string, ArchiveRecord[]>()
    for (const r of sorted) {
      const ym = r.date.length >= 7 ? r.date.slice(0, 7) : '未知日期'
      if (!map.has(ym)) map.set(ym, [])
      map.get(ym)!.push(r)
    }
    return map
  }, [filteredRecords])

  // ── Helpers ───────────────────────────────────────────────────

  function statusBadge(status: string, small = false) {
    const cls = STATUS_COLORS[status as InquiryStatus] ?? 'bg-gray-100 text-gray-500'
    return (
      <span className={`rounded font-medium ${small ? 'text-[10px] px-1 py-px' : 'text-xs px-1.5 py-0.5'} ${cls}`}>
        {status}
      </span>
    )
  }

  function recordLabel(r: ArchiveRecord): string {
    const base = `${r.date} ${r.type} ${r.country}`
    return r.romanNumeral ? `${base} ${r.romanNumeral}` : base
  }

  // ── Detail panel ─────────────────────────────────────────────

  function renderCargoGrid(r: ArchiveRecord) {
    const pairs: [string, string | number | null | undefined][] = [
      ['类型', r.type],
      ['目的国', r.country],
      ['托盘数', r.pallets],
      ['重量', r.weight !== null ? `${r.weight} kg` : null],
      ['体积', r.volume !== null ? `${r.volume} CBM` : null],
      ['LDM', r.ldm],
    ]
    const addr = [r.address, [r.postalCode, r.city].filter(Boolean).join(' ')].filter(Boolean)
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          {pairs.map(([label, val]) => val !== null && val !== undefined && val !== '' ? (
            <div key={label} className="flex gap-1.5 text-xs">
              <span className="text-gray-400 shrink-0 w-14 text-right">{label}</span>
              <span className="text-gray-700 font-medium">{String(val)}</span>
            </div>
          ) : null)}
        </div>
        {addr.map((line, i) => (
          <div key={i} className="flex gap-1.5 text-xs">
            <span className="text-gray-400 shrink-0 w-14 text-right">{i === 0 ? '地址' : ''}</span>
            <span className="text-gray-600">{line}</span>
          </div>
        ))}
        {r.remark && (
          <div className="flex gap-1.5 text-xs">
            <span className="text-gray-400 shrink-0 w-14 text-right">备注</span>
            <span className="text-gray-600 italic">{r.remark}</span>
          </div>
        )}
      </div>
    )
  }

  function DropZone({
    label, hint, active, onOver, onLeave, onDrop, color = 'blue',
  }: {
    label: string; hint?: string; active: boolean
    onOver: () => void; onLeave: () => void; onDrop: (e: React.DragEvent) => void
    color?: 'blue' | 'orange' | 'purple' | 'teal'
  }) {
    const colors = {
      blue:   { active: 'border-blue-400 bg-blue-50 text-blue-600',   idle: 'border-gray-200 text-gray-400 hover:border-blue-300 hover:text-blue-400' },
      orange: { active: 'border-orange-400 bg-orange-50 text-orange-600', idle: 'border-orange-200 text-orange-400 hover:border-orange-300' },
      purple: { active: 'border-purple-400 bg-purple-50 text-purple-600', idle: 'border-purple-200 text-purple-400 hover:border-purple-300' },
      teal:   { active: 'border-teal-400 bg-teal-50 text-teal-600',   idle: 'border-teal-200 text-teal-400 hover:border-teal-300' },
    }
    const c = colors[color]
    return (
      <div
        onDragOver={(e) => { e.preventDefault(); onOver() }}
        onDragLeave={onLeave}
        onDrop={(e) => { e.preventDefault(); onDrop(e) }}
        className={`border-2 border-dashed rounded-lg px-4 py-3 text-center text-xs transition-all cursor-copy ${active ? c.active : c.idle}`}
      >
        <div className="font-medium mb-0.5">{label}</div>
        {hint && <div className="text-[10px] opacity-60">{hint}</div>}
      </div>
    )
  }

  function renderDetail(r: ArchiveRecord) {
    const emailSubject = buildEmail(notionToFormData(r)).subject
    const knownStatus = INQUIRY_STATUSES.includes(r.status as InquiryStatus)
    const isC = r.status === '已报价'
    const isD_requesting = r.status === '要求出货'
    const isD_confirmed  = r.status === '已要求出货' || r.status === '已要求提货'
    const isD = isD_requesting || isD_confirmed
    const isE = r.status === '已收账单'
    const hasQuote = !!(r.angebotnummer || r.amount != null)

    const showPreisDrop = !r.angebotnummer
    const showPlDrop = r.type === 'BATT' && r.folderPath !== null && (isC || isD)
    const showRechnungDrop = r.rechnungAmount === null && isD

    return (
      <div className="divide-y divide-gray-100">

        {/* ① 标题行 */}
        <div className="py-3">
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <div className="min-w-0">
              <p className="text-[10px] text-gray-400 font-mono mb-0.5">{r.date}</p>
              <h2 className="text-sm font-semibold text-gray-800 leading-tight">
                {countryFlag(r.country)} {r.country} · {r.pallets != null ? `${r.pallets} 托 · ` : ''}{r.type}
                {r.romanNumeral ? ` ${r.romanNumeral}` : ''}
              </h2>
            </div>
            {statusBadge(r.status)}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {r.folderPath && (
              <button onClick={() => window.api.openFolderInFinder(r.folderPath!)} className="text-blue-500 hover:underline">
                在 Finder 中打开 ↗
              </button>
            )}
            {r.angebotnummer && (
              <span className="flex items-center gap-1 text-gray-400">
                Angebot <span className="font-mono text-gray-600">{r.angebotnummer}</span>
                <button
                  onClick={() => window.api.copyToClipboard(r.angebotnummer!)}
                  title="复制 Angebot 号"
                  className="text-gray-300 hover:text-blue-500 transition-colors leading-none"
                >⎘</button>
              </span>
            )}
            {r.rswCode && (
              <span className="text-gray-400">RSW <span className="font-mono text-gray-600">{r.rswCode}</span></span>
            )}
          </div>
        </div>

        {/* ② Dachser 报价 */}
        <div className="py-3 space-y-2">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Dachser 报价</p>

          {!hasQuote ? (
            <div className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] text-gray-400">Preisangebot Nr</span>
                <span className="font-mono text-xs text-gray-300">—</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-gray-400">金额（Netto）</span>
                <span className="font-mono text-xs text-gray-300">—</span>
              </div>
            </div>
          ) : (
            <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-2.5">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-gray-400">Preisangebot Nr</span>
                <span className="font-mono text-xs font-medium text-gray-700">{r.angebotnummer ?? '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-green-600 font-medium">金额（Netto）</span>
                <span className="font-mono text-sm font-bold text-green-700">
                  {r.amount != null ? `€ ${r.amount.toLocaleString('de-DE', { minimumFractionDigits: 2 })}` : '—'}
                </span>
              </div>
            </div>
          )}

          {/* Amber: PDF in folder but amount not extracted */}
          {r.amount === null && r.files.some((f) => /DACHSER_Preisangebot/i.test(f) && /\.pdf$/i.test(f)) && (
            <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              <p className="text-[10px] font-medium text-amber-600">报价 PDF 已在文件夹，金额未提取</p>
              <button
                onClick={() => handleExtractPrice(r)}
                disabled={extractingPrice}
                className="text-xs bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-lg px-2.5 py-1 font-medium transition-colors flex items-center gap-1"
              >
                {extractingPrice && (
                  <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                  </svg>
                )}
                提取金额
              </button>
            </div>
          )}

          {/* A: 询价邮件 form */}
          {r.status === '待询价' && (
            <div className="space-y-1.5 pt-0.5">
              <div>
                <label className="text-[10px] text-gray-500 block mb-0.5">收件人</label>
                <input type="email" value={emailRecipient} placeholder="example@dachser.com"
                  onChange={(e) => setEmailRecipient(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 block mb-0.5">主题</label>
                <div className="text-xs text-gray-600 bg-gray-50 rounded-lg px-2.5 py-1.5 border border-gray-100 break-all">{emailSubject}</div>
              </div>
              <div>
                <label className="text-[10px] text-gray-500 block mb-0.5">正文（可编辑）</label>
                <textarea value={emailBody} onChange={(e) => setEmailBody(e.target.value)} rows={8}
                  className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none" />
              </div>
              <div className="flex gap-1.5">
                <button onClick={handleSendEmail}
                  className="flex-1 bg-blue-500 hover:bg-blue-600 text-white text-xs font-medium rounded-lg px-2 py-1.5 transition-colors">
                  发询价邮件 →
                </button>
                <button onClick={handleMarkInquirySent}
                  className="flex-1 bg-green-500 hover:bg-green-600 text-white text-xs font-medium rounded-lg px-2 py-1.5 transition-colors">
                  ✓ 标记已询价
                </button>
              </div>
            </div>
          )}

          {/* B: waiting */}
          {r.status === '已询价' && (
            <p className="text-xs text-gray-400 text-center py-1">等待 Dachser 回复报价…</p>
          )}

          {/* C/D: 再次询价 */}
          {(isC || isD) && (
            <div className="space-y-1.5">
              <button
                onClick={() => {
                  const { body } = buildEmail(notionToFormData(r))
                  setEmailBody(body)
                  setEmailRecipient(defaultRecipient || INQUIRY_RECIPIENT)
                  setReInquiryOpen(v => !v)
                }}
                className="w-full text-xs border border-orange-200 text-orange-600 hover:bg-orange-50 rounded-lg px-3 py-1.5 font-medium transition-colors"
              >
                {reInquiryOpen ? '收起' : '再次询价 →'}
              </button>
              {reInquiryOpen && (
                <div className="space-y-1.5">
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-0.5">收件人</label>
                    <input type="email" value={emailRecipient} placeholder="example@dachser.com"
                      onChange={(e) => setEmailRecipient(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-0.5">主题</label>
                    <div className="text-xs text-gray-600 bg-gray-50 rounded-lg px-2.5 py-1.5 border border-gray-100 break-all">{buildEmail(notionToFormData(r)).subject}</div>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-0.5">正文（可编辑）</label>
                    <textarea value={emailBody} onChange={(e) => setEmailBody(e.target.value)} rows={8}
                      className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none" />
                  </div>
                  <button onClick={handleSendEmail}
                    className="w-full bg-orange-500 hover:bg-orange-600 text-white text-xs font-medium rounded-lg px-3 py-1.5 transition-colors">
                    发送再次询价邮件 →
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ③ 货物信息 */}
        <div className="py-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">货物信息</p>
            <button
              onClick={async () => {
                const res = await window.api.generateInquiryExcel({ record: r, destFolderPath: r.folderPath ?? null })
                if (res.ok) showNotice(`Excel 已生成：${res.filePath?.split('/').pop() ?? ''}`)
                else showNotice(`Excel 生成失败：${res.error}`, 5000, false, true)
              }}
              className="text-[10px] text-green-600 hover:text-green-800 font-medium transition-colors flex items-center gap-0.5"
            >
              ↓ 重新生成 Inquiry Form
            </button>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            {r.pallets != null && <div><span className="text-gray-400">托盘数</span><span className="text-gray-800 ml-1.5 font-medium">{r.pallets}</span></div>}
            <div><span className="text-gray-400">类型</span><span className={`ml-1.5 px-1.5 py-0.5 rounded font-semibold text-[10px] ${r.type === 'BATT' ? 'bg-orange-100 text-orange-700' : r.type === 'ACC' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>{r.type}</span></div>
            {r.weight != null && <div><span className="text-gray-400">重量</span><span className="text-gray-800 ml-1.5 font-medium">{r.weight} kg</span></div>}
            {r.volume != null && <div><span className="text-gray-400">体积</span><span className="text-gray-800 ml-1.5 font-medium">{r.volume} CBM</span></div>}
            {r.ldm != null && <div><span className="text-gray-400">LDM</span><span className="text-gray-800 ml-1.5 font-medium">{r.ldm}</span></div>}
            {r.dimensions && <div className="col-span-2"><span className="text-gray-400">尺寸</span><span className="text-gray-700 ml-1.5 font-mono text-[10px]">{r.dimensions}</span></div>}
            {r.remark && <div className="col-span-2"><span className="text-gray-400">备注</span><span className="text-gray-600 ml-1.5 italic">{r.remark}</span></div>}
          </div>
        </div>

        {/* ④ 收货地址 */}
        {(r.address || r.postalCode || r.city) && (
          <div className="py-3">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-1.5">收货地址</p>
            <div className="text-xs text-gray-700 space-y-0.5">
              {r.address && <div>{r.address}</div>}
              {(r.postalCode || r.city) && (
                <div>{[r.postalCode, r.city].filter(Boolean).join(' ')} · {countryFlag(r.country)} {r.country}</div>
              )}
            </div>
          </div>
        )}

        {/* ⑤ eLOG 跟踪凭据 (D/E) */}
        {(isD || isE) && (r.angebotnummer || r.rswCode) && (
          <div className="py-3 space-y-2">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">eLOG 跟踪凭据</p>
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-2.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[10px] text-blue-500 mb-0.5">用户名 / 密码</p>
                  <p className="text-sm font-mono font-semibold text-blue-800 break-all">
                    {r.angebotnummer ?? '—'} / {r.rswCode ?? '—'}
                  </p>
                </div>
                <button
                  onClick={() => window.api.copyToClipboard(`${r.angebotnummer ?? ''} / ${r.rswCode ?? ''}`)}
                  title="复制凭据"
                  className="text-blue-300 hover:text-blue-600 transition-colors text-base leading-none shrink-0"
                >⎘</button>
              </div>
              <button
                onClick={() => window.api.openUrl('https://elogistics.dachser.com')}
                className="w-full text-xs bg-blue-500 hover:bg-blue-600 text-white rounded-md px-3 py-1.5 font-medium transition-colors"
              >
                打开 DACHSER eLOG ↗
              </button>
            </div>
            {isD && r.rswCode && (() => {
              const isBatt = r.type === 'BATT'
              const pickupEmail = [
                'Hello,', '',
                'Please proceed as enclosed Auftrag.',
                `The Pickup # is ${r.rswCode}`,
                ...(isBatt ? ['Die Sendung beinhaltet Gefahrgut.', 'GG-Gewicht ', 'UN3480', 'Verpackungsklasse 9 2E'] : []),
                '', 'Packing list attached.', 'BR', '____',
              ].join('\n')
              const hasUnfilledAuftrag = r.files.some(f =>
                /Speditionsauftrag/i.test(f) && /\.pdf$/i.test(f) && !f.startsWith('[')
              )
              return (
                <>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">提货通知邮件</p>
                  <div className="relative">
                    <pre className="text-xs font-mono bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 whitespace-pre-wrap text-gray-700 leading-relaxed pr-8">
                      {pickupEmail}
                    </pre>
                    <button
                      onClick={() => window.api.copyToClipboard(pickupEmail)}
                      title="复制邮件内容"
                      className="absolute top-2 right-2 text-gray-300 hover:text-blue-500 transition-colors text-base leading-none"
                    >⎘</button>
                  </div>
                  <button
                    onClick={() => window.api.copyToClipboard(pickupEmail)}
                    className="w-full text-xs border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-700 rounded-lg px-3 py-1.5 font-medium transition-colors"
                  >
                    复制正文
                  </button>
                  {isBatt && <p className="text-[10px] text-amber-600">⚠️ BATT 货物：请手动附上 Gefahrgut 附件</p>}
                  {r.folderPath && hasUnfilledAuftrag && (
                    <button
                      onClick={() => handleFillAuftrag(r)}
                      disabled={fillingAuftrag}
                      className="w-full text-xs bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white rounded-lg px-3 py-1.5 font-medium transition-colors flex items-center justify-center gap-1.5"
                    >
                      {fillingAuftrag && (
                        <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                        </svg>
                      )}
                      填写 Auftrag
                    </button>
                  )}
                </>
              )
            })()}
            {isD_requesting && (
              <button
                onClick={() => handleMarkStatus('已要求出货')}
                className="w-full text-xs bg-orange-500 hover:bg-orange-600 text-white rounded-lg px-3 py-1.5 font-medium transition-colors"
              >
                ✓ 确认已要求出货
              </button>
            )}
            {isD_confirmed && !pickupAckedIds.has(r.notionPageId) && (
              <button
                onClick={() => markPickupAcked(r.notionPageId)}
                className="w-full text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg px-3 py-1.5 font-medium transition-colors"
              >
                ✓ 标记已查阅
              </button>
            )}
          </div>
        )}

        {/* ⑥ 账单信息 */}
        {(r.rechnungAmount !== null || r.rechnungAmountBrutto !== null || r.invoiceNr) && (
          <div className="py-3">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-1.5">账单信息</p>
            <div className="bg-purple-50 border border-purple-200 rounded-xl px-3 py-2.5 space-y-2">
              {r.invoiceNr && (
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-gray-400">账单号</span>
                  <span className="font-mono text-xs font-medium text-gray-700">{r.invoiceNr}</span>
                </div>
              )}
              <div className="border-t border-purple-100 pt-1.5 space-y-1">
                {r.amount != null && (
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-green-600 font-medium">报价 Netto</span>
                    <span className="font-mono text-xs font-semibold text-green-700">€ {r.amount.toLocaleString('de-DE', { minimumFractionDigits: 2 })}</span>
                  </div>
                )}
                {r.rechnungAmount !== null && (
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-purple-600 font-medium">账单 Netto</span>
                    <span className="font-mono text-xs font-semibold text-purple-700">€ {r.rechnungAmount.toLocaleString('de-DE', { minimumFractionDigits: 2 })}</span>
                  </div>
                )}
                {r.rechnungAmountBrutto !== null && (
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-purple-400">账单 Brutto</span>
                    <span className="font-mono text-xs text-purple-600">€ {r.rechnungAmountBrutto.toLocaleString('de-DE', { minimumFractionDigits: 2 })}</span>
                  </div>
                )}
                {r.amount != null && r.rechnungAmount !== null && (() => {
                  const diff = r.rechnungAmount - r.amount
                  return (
                    <div className="flex items-center justify-between border-t border-purple-100 pt-1">
                      <span className="text-[10px] text-gray-400">差额（Netto）</span>
                      <span className={`font-mono text-xs font-bold ${diff <= 0 ? 'text-green-600' : 'text-red-500'}`}>
                        {diff <= 0 ? '▼' : '▲'} {diff >= 0 ? '+' : ''}€ {Math.abs(diff).toLocaleString('de-DE', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  )
                })()}
              </div>
            </div>
          </div>
        )}

        {/* Drop zones */}
        {showPreisDrop && (
          <div className="py-3 space-y-1.5">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">拖入报价文件</p>
            <DropZone
              label="Preisangebot + Speditionsauftrag"
              hint="自动提取编号，创建本地文件夹，状态 → 已报价"
              active={preisDropActive}
              onOver={() => setPreisDropActive(true)}
              onLeave={() => setPreisDropActive(false)}
              onDrop={handlePreisDrop}
              color="blue"
            />
          </div>
        )}
        {showPlDrop && (
          <div className="py-3">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-1.5">Packing List</p>
            <DropZone
              label="Packing List (PL)"
              active={plDropActive}
              onOver={() => setPlDropActive(true)}
              onLeave={() => setPlDropActive(false)}
              onDrop={handlePlDrop}
              color="teal"
            />
          </div>
        )}
        {showRechnungDrop && (
          <div className="py-3">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-1.5">账单</p>
            <DropZone
              label="Rechnung PDF"
              hint="自动提取金额，状态 → 已收账单"
              active={rechnungDropActive}
              onOver={() => setRechnungDropActive(true)}
              onLeave={() => setRechnungDropActive(false)}
              onDrop={handleRechnungDrop}
              color="purple"
            />
          </div>
        )}

        {/* Files in folder */}
        {r.files.length > 0 && (() => {
          const visible = r.files.filter((f) => !f.startsWith('~$') && !f.startsWith('._') && !f.startsWith('.'))
          return visible.length > 0 ? (
            <div className="py-3">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-1.5">文件夹内容</p>
              <ul className="space-y-0.5">
                {visible.map((f) => (
                  <li key={f} className="text-xs text-gray-600 bg-gray-50 rounded px-2.5 py-1 font-mono truncate">{f}</li>
                ))}
              </ul>
            </div>
          ) : null
        })()}

        {/* Legacy status buttons */}
        {!knownStatus && r.status && (
          <div className="py-3">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-1.5">更新状态</p>
            <div className="flex flex-wrap gap-1.5">
              {INQUIRY_STATUSES.map((s) => (
                <button key={s} onClick={() => handleMarkStatus(s)}
                  className={`text-xs px-2 py-1 rounded-lg border transition-colors hover:opacity-80 ${STATUS_COLORS[s]}`}>
                  → {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  function toggleGroup(ym: string) {
    setOpenGroup(prev => prev === ym ? null : ym)
  }

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {notice && (
        <div className={`px-3 py-2 text-xs border-b flex items-start gap-2 ${
          notice.isError  ? 'bg-red-50 border-red-200 text-red-700'
          : notice.isWarn ? 'bg-yellow-50 border-yellow-200 text-yellow-700'
          : 'bg-green-50 border-green-200 text-green-700'
        }`}>
          <span className="flex-1">{notice.msg}</span>
          <button onClick={() => { if (noticeTimer.current) clearTimeout(noticeTimer.current); setNotice(null) }}
            className="shrink-0 opacity-60 hover:opacity-100 font-bold text-sm leading-none">✕</button>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {/* Left: list */}
        <div className="w-72 shrink-0 border-r border-gray-200 flex flex-col">
          {/* Toolbar */}
          <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide shrink-0">询价管理</span>
            <ToolbarMenu
              loading={loading}
              bulkExtractProgress={bulkExtractProgress}
              onRefresh={() => loadData()}
              onCalibrate={handleBuildCalibration}
              onBulkExtract={handleBulkExtractPrices}
              onNormalize={handlePlanRenames}
            />
          </div>

          {/* Status filter pills */}
          <div className="px-2 py-1.5 border-b border-gray-100 flex flex-wrap gap-1">
            <button onClick={() => setStatusFilter('all')}
              className={`text-xs px-1.5 py-0.5 rounded transition-colors ${
                statusFilter === 'all' ? 'bg-gray-200 text-gray-700' : 'text-gray-400 hover:text-gray-600'
              }`}>
              全部 ({records.length})
            </button>
            {INQUIRY_STATUSES.filter((s) => (statusCounts[s] ?? 0) > 0).map((s) => (
              <button key={s} onClick={() => setStatusFilter(statusFilter === s ? 'all' : s)}
                className={`text-xs px-1.5 py-0.5 rounded transition-colors ${
                  statusFilter === s ? STATUS_COLORS[s] : 'text-gray-400 hover:text-gray-600'
                }`}>
                {s} ({statusCounts[s]})
              </button>
            ))}
            {/* Legacy status pills */}
            {Object.keys(statusCounts).filter((s) => !INQUIRY_STATUSES.includes(s as never)).map((s) => (
              <button key={s} onClick={() => setStatusFilter(statusFilter === s ? 'all' : s)}
                className={`text-xs px-1.5 py-0.5 rounded transition-colors ${
                  statusFilter === s ? 'bg-gray-300 text-gray-700' : 'text-gray-400 hover:text-gray-600'
                }`}>
                {s} ({statusCounts[s]})
              </button>
            ))}
          </div>

          {/* Record list — year-month grouped, collapsible */}
          <div className="flex-1 overflow-y-auto">
            {loading && <p className="text-xs text-gray-400 px-3 py-4">正在从 Notion 加载…</p>}
            {!loading && filteredRecords.length === 0 && (
              <p className="text-xs text-gray-400 px-3 py-4">
                {records.length === 0 ? '暂无询价记录。请先配置 Notion。' : '当前筛选无匹配记录。'}
              </p>
            )}
            {[...byYearMonth.entries()].map(([ym, group]) => {
              const expanded = openGroup === ym
              return (
                <div key={ym}>
                  {/* Group header — accordion toggle */}
                  <button
                    onClick={() => toggleGroup(ym)}
                    className="w-full px-3 py-1.5 text-[10px] font-semibold text-gray-400 bg-gray-50 border-b border-gray-100 flex items-center gap-1.5 uppercase tracking-wide hover:bg-gray-100 transition-colors"
                  >
                    <span className="flex-1 text-left">{ym} · {group.length} 条</span>
                    <span className="text-gray-300 text-[8px]">{expanded ? '▼' : '▶'}</span>
                  </button>
                  {expanded && group.map((r) => (
                    <button key={r.notionPageId} onClick={() => { setSelected(r); setReInquiryOpen(false) }}
                      className={`w-full text-left px-3 py-2 border-b border-gray-50 hover:bg-blue-50 transition-colors ${
                        selected?.notionPageId === r.notionPageId ? 'bg-blue-50 border-l-2 border-l-blue-400' : ''
                      }`}>
                      {/* Row 1: flag + country + date + status */}
                      <div className="flex items-center justify-between gap-1">
                        <div className="flex items-center gap-1 min-w-0">
                          {(r.status === '待询价' ||
                            r.status === '要求出货' ||
                            ((r.status === '已要求出货' || r.status === '已要求提货') && !pickupAckedIds.has(r.notionPageId))) && (
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0 animate-pulse" />
                          )}
                          <span className="text-sm leading-none shrink-0">{countryFlag(r.country)}</span>
                          <span className="text-xs font-bold text-gray-800 shrink-0">{r.country}</span>
                          <span className="text-[11px] text-gray-400 tabular-nums truncate">{r.date.slice(5)}</span>
                        </div>
                        {statusBadge(r.status, true)}
                      </div>
                      {/* Row 2: pallets + type + weight + amount */}
                      <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                        {r.pallets != null && (
                          <span className="text-[11px] text-gray-600">{r.pallets}托</span>
                        )}
                        {typeBadge(r.type)}
                        {r.weight != null && (
                          <span className="text-[11px] text-gray-400">{r.weight}kg</span>
                        )}
                        {r.amount != null && (
                          <span className="ml-auto text-[11px] font-semibold text-green-700 tabular-nums shrink-0">
                            €{r.amount.toLocaleString('de-DE', { minimumFractionDigits: 2 })}
                          </span>
                        )}
                      </div>
                      {/* Row 3: Pickup# if set */}
                      {r.rswCode && (
                        <div className="text-[10px] font-mono text-orange-600 mt-0.5 truncate">{r.rswCode}</div>
                      )}
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        </div>

        {/* Right: detail panel */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
          {!selected ? (
            <p className="text-sm text-gray-400 mt-8 text-center">← 点击左侧记录查看详情</p>
          ) : (
            renderDetail(selected)
          )}
        </div>
      </div>

      {/* ── Rename modal ── */}
      {renamePreview && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-[680px] max-h-[80vh] flex flex-col">
            <div className="px-5 py-3.5 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-800">规范化文件夹名 — 预览</h3>
              <span className="text-xs text-gray-400">{renamePreview.length} 个文件夹将被重命名</span>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
              {renamePreview.map((item) => (
                <div key={item.oldPath} className="text-xs space-y-0.5">
                  <div className="text-gray-400 line-through">{item.oldName}</div>
                  <div className="text-green-700 font-medium">→ {item.newName}</div>
                </div>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
              <button onClick={() => setRenamePreview(null)}
                className="text-sm text-gray-500 hover:text-gray-700 px-4 py-1.5 rounded-lg border border-gray-300">取消</button>
              <button onClick={handleExecuteRenames} disabled={renaming}
                className="text-sm text-white bg-orange-500 hover:bg-orange-600 disabled:opacity-40 px-4 py-1.5 rounded-lg">
                {renaming ? '重命名中…' : '确认重命名'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Calibration modal ── */}
      {calPreview && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-[720px] max-h-[80vh] flex flex-col">
            <div className="px-5 py-3.5 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-gray-800">状态校准预览</h3>
                <p className="text-xs text-gray-400 mt-0.5">根据本地文件夹内容推导，将更新以下 {calPreview.length} 条记录</p>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-1.5">
              {/* Header row */}
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide px-2 pb-1 border-b border-gray-100">
                <span>记录</span><span>当前状态</span><span></span><span>校准后状态</span>
              </div>
              {calPreview.map((item) => (
                <div key={item.record.notionPageId}
                  className="grid grid-cols-[1fr_auto_auto_auto] gap-3 items-center text-xs bg-gray-50 hover:bg-gray-100 rounded-lg px-2 py-2 transition-colors">
                  <div>
                    <div className="font-medium text-gray-700 truncate">{recordLabel(item.record)}</div>
                    <div className="text-[10px] text-gray-400 mt-0.5 font-mono">
                      {[item.angebotnummer && `Angebot: ${item.angebotnummer}`, item.rswCode && `RSW: ${item.rswCode}`].filter(Boolean).join('  ')}
                    </div>
                  </div>
                  {statusBadge(item.record.status, true)}
                  <span className="text-gray-400">→</span>
                  {statusBadge(item.newStatus, true)}
                </div>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-gray-200">
              {calibrating && calProgress ? (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-gray-500">
                    <span className="truncate max-w-[420px] text-gray-600">{calProgress.current}</span>
                    <span className="shrink-0 ml-2 font-mono tabular-nums">{calProgress.done} / {calProgress.total}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500 rounded-full transition-all duration-300"
                      style={{ width: `${Math.round((calProgress.done / calProgress.total) * 100)}%` }}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex justify-end gap-2">
                  <button onClick={() => setCalPreview(null)}
                    className="text-sm text-gray-500 hover:text-gray-700 px-4 py-1.5 rounded-lg border border-gray-300">取消</button>
                  <button onClick={handleConfirmCalibration}
                    className="text-sm text-white bg-green-600 hover:bg-green-700 px-4 py-1.5 rounded-lg font-medium">
                    确认更新 {calPreview.length} 条
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
