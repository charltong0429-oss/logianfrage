import React, { useState, useCallback } from 'react'

interface ImportResult {
  ok: boolean
  action?: string
  destPath?: string
  error?: string
  record?: { date: string; type: string; country: string; status: string; notionPageId: string }
}

interface LogEntry {
  filename: string
  result: ImportResult
  time: string
}

// ── Angebot preview types ─────────────────────────────────────────

interface AngebotMatchDetail {
  country: boolean | null
  typeOk:  boolean | null
  zip:     boolean | null
  pallets: boolean | null
  weight:  boolean | null
  volume:  boolean | null
}

interface AngebotCandidate {
  notionPageId: string
  date: string; type: string; country: string
  postalCode: string | null; city: string | null
  pallets: number | null; weight: number | null; volume: number | null
  status: string; angebotnummer: string | null
  score: number
  matchDetails: AngebotMatchDetail
}

interface AngebotPdfData {
  angebotnummer: string | null; amount: number | null; gefahrgut: boolean | null
  destCountryCode: string | null; destZip: string | null; destCity: string | null
  pallets: number | null; volume: number | null; weight: number | null
}

interface AngebotPreviewResult {
  ok: boolean; error?: string
  pdfData: AngebotPdfData
  candidates: AngebotCandidate[]
}

// ── Rechnung preview types ────────────────────────────────────────

interface RechnungCandidate {
  notionPageId: string
  date: string; type: string; country: string; status: string
  angebotnummer: string | null; rswCode: string | null
  score: number; matchLabel: string | null
}

interface RechnungPreviewPosition {
  positionIndex: number
  tagespreisNr: string | null; rswCode: string | null; nettoAmount: number | null
  candidates: RechnungCandidate[]
}

interface RechnungPreviewResult {
  ok: boolean; error?: string
  invoiceNr: string | null
  nettoTotal: number | null
  bruttoTotal: number | null
  positions: RechnungPreviewPosition[]
}

// ── Unified drop zone ─────────────────────────────────────────────

interface PdfTypePick {
  filePath: string
  filename: string
}

function PdfTypeModal({ filename, onPick, onCancel }: {
  filename: string
  onPick: (zone: ZoneKey) => void
  onCancel: () => void
}) {
  const options: { key: ZoneKey; icon: string; label: string; desc: string }[] = [
    { key: 'angebot', icon: '📄', label: 'Angebot',  desc: 'DACHSER 报价单' },
    { key: 'auftrag', icon: '📦', label: 'Auftrag',  desc: 'Speditionsauftrag' },
    { key: 'invoice', icon: '🧾', label: 'Invoice',  desc: 'DACHSER 账单' },
  ]
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-[420px] overflow-hidden">
        <div className="px-6 pt-5 pb-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">选择文件类型</h2>
          <p className="text-xs text-gray-400 mt-1 truncate">{filename}</p>
        </div>
        <div className="p-4 grid grid-cols-3 gap-3">
          {options.map(o => (
            <button
              key={o.key}
              onClick={() => onPick(o.key)}
              className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-all"
            >
              <span className="text-3xl">{o.icon}</span>
              <span className="text-sm font-semibold text-gray-800">{o.label}</span>
              <span className="text-[11px] text-gray-400 text-center leading-snug">{o.desc}</span>
            </button>
          ))}
        </div>
        <div className="px-6 pb-4 flex justify-end">
          <button onClick={onCancel} className="text-xs text-gray-400 hover:text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            取消
          </button>
        </div>
      </div>
    </div>
  )
}

function UnifiedDropZone({ loading, allLogs, onDrop }: {
  loading: boolean
  allLogs: LogEntry[]
  onDrop: (filePath: string, filename: string, ext: string) => void
}) {
  const [dragging, setDragging] = useState(false)

  const preventAndMark = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setDragging(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    const filePath = window.api.getDroppedFilePath(file)
    const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
    if (!['xlsx', 'xls', 'pdf'].includes(ext)) {
      onDrop('', file.name, ext)
      return
    }
    onDrop(filePath, file.name, ext)
  }, [onDrop])

  return (
    <div className="flex flex-col gap-3">
      <div
        onDragEnter={preventAndMark} onDragOver={preventAndMark}
        onDragLeave={handleDragLeave} onDrop={handleDrop}
        className={`border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-3 transition-all select-none
          ${dragging ? 'border-blue-400 bg-blue-50' : 'border-gray-300 bg-gray-50 hover:border-gray-400'}
          ${loading ? 'opacity-60 pointer-events-none' : 'cursor-default'}`}
        style={{ minHeight: 96 }}
      >
        {loading ? (
          <div className="flex items-center gap-2 text-gray-500">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
            </svg>
            <span className="text-sm">处理中…</span>
          </div>
        ) : (
          <div className="flex items-center gap-4 px-6">
            <span className="text-3xl select-none shrink-0">📁</span>
            <div>
              <p className="text-sm font-semibold text-gray-700">拖入文件</p>
              <p className="text-xs text-gray-400 mt-0.5">询价 Excel · Angebot · Auftrag · Invoice PDF</p>
            </div>
          </div>
        )}
      </div>

      {/* Unified log */}
      <div className="space-y-1 max-h-56 overflow-y-auto">
        {allLogs.map((entry, i) => (
          <div key={i} className={`text-xs px-2.5 py-1.5 rounded-lg leading-snug ${
            entry.result.ok
              ? 'bg-green-50 border border-green-100 text-green-800'
              : 'bg-red-50 border border-red-100 text-red-700'
          }`}>
            <div className="flex items-start gap-1.5">
              <span className="shrink-0 mt-0.5">{entry.result.ok ? '✓' : '✗'}</span>
              <div className="min-w-0">
                <span className="font-medium break-all">{entry.filename}</span>
                {entry.result.ok && entry.result.action && (
                  <span className="ml-1 text-green-600">→ {entry.result.action}</span>
                )}
                {entry.result.ok && entry.result.record && (
                  <span className="ml-1 text-gray-500">
                    ({entry.result.record.date} {entry.result.record.type} {entry.result.record.country})
                  </span>
                )}
                {!entry.result.ok && <div className="text-red-600 mt-0.5">{entry.result.error}</div>}
                <span className="text-gray-300 ml-1">{entry.time}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Shared badge components ───────────────────────────────────────

function TypeBadge({ type }: { type: string }) {
  const cls = type === 'BATT' ? 'bg-orange-100 text-orange-700' :
              type === 'ACC'  ? 'bg-blue-100 text-blue-700' :
                                'bg-gray-100 text-gray-600'
  return <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${cls}`}>{type}</span>
}

function StatusPill({ status }: { status: string }) {
  const cls =
    status === '待询价' ? 'bg-blue-50 text-blue-500' :
    status === '已询价' ? 'bg-yellow-50 text-yellow-600' :
    status === '已报价' ? 'bg-green-50 text-green-600' :
    status === '已要求提货' ? 'bg-orange-50 text-orange-600' :
    'bg-gray-100 text-gray-500'
  return <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${cls}`}>{status}</span>
}

function ScoreBadge({ score }: { score: number }) {
  const cls = score >= 15 ? 'text-green-700 bg-green-100' :
              score >= 8  ? 'text-yellow-700 bg-yellow-100' :
              score > 0   ? 'text-gray-500 bg-gray-100' :
                            'text-gray-400 bg-gray-50'
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${cls}`}>
      {score > 0 ? '+' : ''}{score}
    </span>
  )
}

function Spinner() {
  return (
    <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
    </svg>
  )
}

// ── Angebot match modal ───────────────────────────────────────────

function MatchChip({ ok, label }: { ok: boolean | null; label: string }) {
  if (ok === null) return <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-400">— {label}</span>
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
      {ok ? '✓' : '✗'} {label}
    </span>
  )
}

function DataRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-gray-400 text-[10px] uppercase tracking-wide leading-none mb-0.5">{label}</span>
      <span className={`${accent ? 'text-orange-600 font-semibold' : 'text-gray-800'} text-xs`}>{value}</span>
    </div>
  )
}

function AngebotMatchModal({ filename, preview, selectedId, onSelect, onConfirm, onCancel, confirmLoading }: {
  filename: string; preview: AngebotPreviewResult; selectedId: string | null
  onSelect: (id: string) => void; onConfirm: () => void; onCancel: () => void; confirmLoading: boolean
}) {
  const pdf = preview.pdfData
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-[800px] max-h-[88vh] flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-gray-900">确认 Angebot 匹配</h2>
            <p className="text-xs text-gray-400 mt-0.5 truncate max-w-[600px]">{filename}</p>
          </div>
          <button onClick={onCancel} className="ml-4 text-gray-400 hover:text-gray-600 text-xl font-light leading-none shrink-0">×</button>
        </div>

        {preview.ok ? (
          <div className="flex flex-1 overflow-hidden min-h-0">
            <div className="w-52 shrink-0 p-5 border-r border-gray-100 bg-gray-50 overflow-y-auto space-y-3.5">
              <p className="text-xs font-semibold text-gray-600">PDF 提取内容</p>
              <DataRow label="Angebotnummer" value={pdf.angebotnummer ?? '—'} />
              <DataRow label="报价金额" value={pdf.amount !== null ? `€${pdf.amount}` : '—'} />
              <DataRow label="Gefahrgut" accent={pdf.gefahrgut === true}
                value={pdf.gefahrgut === true ? '⚠ Ja' : pdf.gefahrgut === false ? 'Nein' : '—'} />
              <DataRow label="目的国" value={pdf.destCountryCode ?? '—'} />
              <DataRow label="邮编" value={pdf.destZip ?? '—'} />
              <DataRow label="城市" value={pdf.destCity ?? '—'} />
              <DataRow label="托盘数" value={pdf.pallets !== null ? String(pdf.pallets) : '—'} />
              <DataRow label="体积" value={pdf.volume !== null ? `${pdf.volume} m³` : '—'} />
              <DataRow label="重量" value={pdf.weight !== null ? `${pdf.weight} kg` : '—'} />
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2 min-w-0">
              <p className="text-xs font-semibold text-gray-500">候选记录（按匹配度排序）</p>
              {preview.candidates.length === 0 ? (
                <p className="text-xs text-gray-400 py-6 text-center">未找到候选记录</p>
              ) : preview.candidates.map(c => (
                <button key={c.notionPageId} onClick={() => onSelect(c.notionPageId)}
                  className={`w-full text-left p-3 rounded-xl border-2 transition-all ${
                    selectedId === c.notionPageId ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}>
                  <div className="flex items-center justify-between mb-1.5 gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-800 text-sm">{c.date}</span>
                      <TypeBadge type={c.type} />
                      <span className="text-gray-500 font-mono text-xs">{c.country}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <StatusPill status={c.status} />
                      <ScoreBadge score={c.score} />
                    </div>
                  </div>
                  {(c.postalCode || c.city || c.pallets !== null || c.weight !== null || c.volume !== null) && (
                    <div className="text-xs text-gray-400 flex flex-wrap gap-x-3 gap-y-0.5 mb-1.5">
                      {c.postalCode && <span>{c.postalCode}</span>}
                      {c.city && <span>{c.city}</span>}
                      {c.pallets !== null && <span>{c.pallets} 托</span>}
                      {c.weight !== null && <span>{c.weight} kg</span>}
                      {c.volume !== null && <span>{c.volume} m³</span>}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1">
                    <MatchChip ok={c.matchDetails.country} label="国家" />
                    <MatchChip ok={c.matchDetails.typeOk}  label="类型" />
                    <MatchChip ok={c.matchDetails.zip}     label="邮编" />
                    <MatchChip ok={c.matchDetails.pallets} label="托盘" />
                    <MatchChip ok={c.matchDetails.weight}  label="重量" />
                    <MatchChip ok={c.matchDetails.volume}  label="体积" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="p-6 text-sm text-red-600">{preview.error ?? 'PDF 解析失败'}</div>
        )}

        <div className="px-6 py-3.5 border-t border-gray-100 flex justify-end gap-2 shrink-0">
          <button onClick={onCancel} className="px-4 py-1.5 rounded-lg text-sm text-gray-600 hover:bg-gray-100 transition-colors">取消</button>
          {preview.ok && (
            <button onClick={onConfirm} disabled={!selectedId || confirmLoading}
              className="px-4 py-1.5 rounded-lg text-sm bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 transition-colors">
              {confirmLoading && <Spinner />}
              确认匹配并导入
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Rechnung match modal ──────────────────────────────────────────

function MatchLabelBadge({ label }: { label: string | null }) {
  if (!label) return <span className="text-[10px] text-gray-400">— 无匹配依据</span>
  const isStrong = label.includes('精确')
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
      isStrong ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
    }`}>
      {isStrong ? '★ ' : '◎ '}{label}
    </span>
  )
}

function RechnungMatchModal({ filename, preview, selectionsByPos, onSelect, onConfirm, onCancel, confirmLoading }: {
  filename: string; preview: RechnungPreviewResult
  selectionsByPos: Record<number, string>
  onSelect: (posIdx: number, notionPageId: string) => void
  onConfirm: () => void; onCancel: () => void; confirmLoading: boolean
}) {
  const allSelected = preview.positions.every(p => selectionsByPos[p.positionIndex])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-[760px] max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-gray-900">确认 Rechnung 匹配</h2>
            <p className="text-xs text-gray-400 mt-0.5 truncate max-w-[580px]">{filename}</p>
          </div>
          <button onClick={onCancel} className="ml-4 text-gray-400 hover:text-gray-600 text-xl font-light leading-none shrink-0">×</button>
        </div>

        {/* Invoice summary bar */}
        {preview.ok && (
          <div className="px-6 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center gap-4 text-xs text-gray-600 shrink-0">
            {preview.invoiceNr && <span>Invoice Nr: <span className="font-mono font-medium">{preview.invoiceNr}</span></span>}
            {preview.nettoTotal !== null && <span>Netto: <span className="font-semibold">€{preview.nettoTotal.toFixed(2)}</span></span>}
            {preview.bruttoTotal !== null && <span>Brutto: <span className="font-semibold text-gray-800">€{preview.bruttoTotal.toFixed(2)}</span></span>}
            <span className="text-gray-400">{preview.positions.length} 张运单</span>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {!preview.ok ? (
            <div className="p-6 text-sm text-red-600">{preview.error ?? 'PDF 解析失败'}</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {preview.positions.map((pos) => (
                <div key={pos.positionIndex} className="p-4">
                  {/* Position header */}
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-xs font-semibold text-gray-500">
                      运单 {pos.positionIndex + 1}/{preview.positions.length}
                    </span>
                    {pos.tagespreisNr && (
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-mono">
                        Tagespreis: {pos.tagespreisNr}
                      </span>
                    )}
                    {pos.rswCode && (
                      <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded font-mono">
                        RSW: {pos.rswCode}
                      </span>
                    )}
                    {pos.nettoAmount !== null && (
                      <span className="text-xs font-semibold text-gray-700 ml-auto">
                        Netto €{pos.nettoAmount.toFixed(2)}
                      </span>
                    )}
                  </div>
                  {/* Candidates */}
                  <div className="space-y-1.5">
                    {pos.candidates.length === 0 ? (
                      <p className="text-xs text-gray-400 py-2 text-center">未找到候选记录</p>
                    ) : pos.candidates.map(c => (
                      <button key={c.notionPageId}
                        onClick={() => onSelect(pos.positionIndex, c.notionPageId)}
                        className={`w-full text-left px-3 py-2.5 rounded-xl border-2 transition-all ${
                          selectionsByPos[pos.positionIndex] === c.notionPageId
                            ? 'border-green-400 bg-green-50'
                            : 'border-gray-200 bg-white hover:border-gray-300'
                        }`}>
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-gray-800 text-sm">{c.date}</span>
                            <TypeBadge type={c.type} />
                            <span className="text-gray-500 font-mono text-xs">{c.country}</span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <StatusPill status={c.status} />
                            <ScoreBadge score={c.score} />
                          </div>
                        </div>
                        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                          {c.angebotnummer && (
                            <span className="text-[10px] font-mono text-gray-400">Nr: {c.angebotnummer}</span>
                          )}
                          {c.rswCode && (
                            <span className="text-[10px] font-mono text-gray-400">RSW: {c.rswCode}</span>
                          )}
                          <MatchLabelBadge label={c.matchLabel} />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-gray-100 flex justify-end gap-2 shrink-0">
          <button onClick={onCancel} className="px-4 py-1.5 rounded-lg text-sm text-gray-600 hover:bg-gray-100 transition-colors">取消</button>
          {preview.ok && (
            <button onClick={onConfirm} disabled={!allSelected || confirmLoading}
              className="px-4 py-1.5 rounded-lg text-sm bg-green-500 text-white hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 transition-colors">
              {confirmLoading && <Spinner />}
              确认匹配并导入{preview.positions.length > 1 ? `（${preview.positions.length} 张）` : ''}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Utilities ─────────────────────────────────────────────────────

function iconFor(title: string): string {
  if (title.includes('询价')) return '📋'
  if (title.includes('Angebot')) return '📄'
  if (title.includes('Auftrag')) return '📦'
  if (title.includes('Invoice')) return '🧾'
  return '📁'
}

function nowTime(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

const MAX_LOG = 20
type ZoneKey = 'inquiry' | 'angebot' | 'auftrag' | 'invoice'

// ── Main component ────────────────────────────────────────────────

export default function FileImportTab() {
  const [loading, setLoading] = useState<Record<ZoneKey, boolean>>({
    inquiry: false, angebot: false, auftrag: false, invoice: false,
  })
  const [logs, setLogs] = useState<LogEntry[]>([])

  // PDF type picker state
  const [pdfTypePick, setPdfTypePick] = useState<PdfTypePick | null>(null)

  // Angebot modal state
  const [angebotPreview, setAngebotPreview] = useState<AngebotPreviewResult | null>(null)
  const [pendingAngebotFile, setPendingAngebotFile] = useState<{ filePath: string; filename: string } | null>(null)
  const [selectedAngebotId, setSelectedAngebotId] = useState<string | null>(null)
  const [angebotConfirmLoading, setAngebotConfirmLoading] = useState(false)

  // Rechnung modal state
  const [rechnungPreview, setRechnungPreview] = useState<RechnungPreviewResult | null>(null)
  const [pendingRechnungFile, setPendingRechnungFile] = useState<{ filePath: string; filename: string } | null>(null)
  const [rechnungSelections, setRechnungSelections] = useState<Record<number, string>>({})
  const [rechnungConfirmLoading, setRechnungConfirmLoading] = useState(false)

  function appendLog(filename: string, result: ImportResult) {
    setLogs(prev => [{ filename, result, time: nowTime() }, ...prev].slice(0, MAX_LOG))
  }

  async function handleZoneDrop(zone: ZoneKey, filePath: string, filename: string) {
    if (!filePath) {
      appendLog(filename, { ok: false, error: '文件类型不匹配，请拖入 XLSX 或 PDF' })
      return
    }

    if (zone === 'angebot') {
      setLoading(prev => ({ ...prev, angebot: true }))
      try {
        const preview = await window.api.previewAngebotMatch(filePath)
        if (!preview.ok) {
          appendLog(filename, { ok: false, error: preview.error ?? 'PDF 解析失败' })
        } else {
          setPendingAngebotFile({ filePath, filename })
          setAngebotPreview(preview)
          setSelectedAngebotId(preview.candidates[0]?.notionPageId ?? null)
        }
      } catch (e) {
        appendLog(filename, { ok: false, error: String(e) })
      } finally {
        setLoading(prev => ({ ...prev, angebot: false }))
      }
      return
    }

    if (zone === 'invoice') {
      setLoading(prev => ({ ...prev, invoice: true }))
      try {
        const preview = await window.api.previewRechnungMatch(filePath)
        if (!preview.ok) {
          appendLog(filename, { ok: false, error: preview.error ?? 'PDF 解析失败' })
        } else {
          const initialSelections: Record<number, string> = {}
          for (const pos of preview.positions) {
            if (pos.candidates[0]) initialSelections[pos.positionIndex] = pos.candidates[0].notionPageId
          }
          setPendingRechnungFile({ filePath, filename })
          setRechnungPreview(preview)
          setRechnungSelections(initialSelections)
        }
      } catch (e) {
        appendLog(filename, { ok: false, error: String(e) })
      } finally {
        setLoading(prev => ({ ...prev, invoice: false }))
      }
      return
    }

    setLoading(prev => ({ ...prev, [zone]: true }))
    try {
      let result: ImportResult
      switch (zone) {
        case 'inquiry': result = await window.api.importInquiryExcel(filePath); break
        case 'auftrag': result = await window.api.importAuftragPdf(filePath);   break
        default: return
      }
      appendLog(filename, result)
    } catch (e) {
      appendLog(filename, { ok: false, error: String(e) })
    } finally {
      setLoading(prev => ({ ...prev, [zone]: false }))
    }
  }

  function handleUnifiedDrop(filePath: string, filename: string, ext: string) {
    if (!filePath) {
      appendLog(filename, { ok: false, error: '文件类型不支持，请拖入 XLSX 或 PDF' })
      return
    }
    if (ext === 'xlsx' || ext === 'xls') {
      handleZoneDrop('inquiry', filePath, filename)
    } else if (ext === 'pdf') {
      setPdfTypePick({ filePath, filename })
    }
  }

  // Angebot confirm/cancel
  async function handleConfirmAngebot() {
    if (!pendingAngebotFile || !angebotPreview || !selectedAngebotId) return
    setAngebotConfirmLoading(true)
    try {
      const result = await window.api.confirmAngebotImport({
        filePath: pendingAngebotFile.filePath,
        notionPageId: selectedAngebotId,
        pdfData: angebotPreview.pdfData,
      })
      appendLog(pendingAngebotFile.filename, result)
    } catch (e) {
      appendLog(pendingAngebotFile.filename, { ok: false, error: String(e) })
    } finally {
      setAngebotConfirmLoading(false)
      setAngebotPreview(null); setPendingAngebotFile(null); setSelectedAngebotId(null)
    }
  }

  function handleCancelAngebot() {
    if (pendingAngebotFile) appendLog(pendingAngebotFile.filename, { ok: false, error: '已取消' })
    setAngebotPreview(null); setPendingAngebotFile(null); setSelectedAngebotId(null)
  }

  // Rechnung confirm/cancel
  async function handleConfirmRechnung() {
    if (!pendingRechnungFile || !rechnungPreview) return
    setRechnungConfirmLoading(true)
    try {
      const matches = rechnungPreview.positions.map(pos => ({
        positionIndex: pos.positionIndex,
        notionPageId: rechnungSelections[pos.positionIndex],
        nettoAmount: pos.nettoAmount,
      }))
      const result = await window.api.confirmRechnungImport({
        filePath: pendingRechnungFile.filePath,
        bruttoTotal: rechnungPreview.bruttoTotal,
        nettoTotal: rechnungPreview.nettoTotal,
        invoiceNr: rechnungPreview.invoiceNr,
        matches,
      })
      const successCount = result.results.filter(r => r.ok).length
      const failCount = result.results.length - successCount
      appendLog(pendingRechnungFile.filename, {
        ok: result.ok,
        action: result.ok
          ? `已收账单，更新 ${successCount} 条记录${rechnungPreview.bruttoTotal !== null ? `（Brutto €${rechnungPreview.bruttoTotal.toFixed(2)}）` : ''}`
          : undefined,
        error: !result.ok
          ? `部分失败（${failCount}/${result.results.length}）: ${result.results.find(r => !r.ok)?.error}`
          : undefined,
      })
    } catch (e) {
      appendLog(pendingRechnungFile.filename, { ok: false, error: String(e) })
    } finally {
      setRechnungConfirmLoading(false)
      setRechnungPreview(null); setPendingRechnungFile(null); setRechnungSelections({})
    }
  }

  function handleCancelRechnung() {
    if (pendingRechnungFile) appendLog(pendingRechnungFile.filename, { ok: false, error: '已取消' })
    setRechnungPreview(null); setPendingRechnungFile(null); setRechnungSelections({})
  }

  const anyLoading = Object.values(loading).some(Boolean)

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-2xl mx-auto">
      <UnifiedDropZone
        loading={anyLoading}
        allLogs={logs}
        onDrop={handleUnifiedDrop}
      />

      {/* PDF type picker modal */}
      {pdfTypePick && (
        <PdfTypeModal
          filename={pdfTypePick.filename}
          onPick={(zone) => {
            const { filePath, filename } = pdfTypePick
            setPdfTypePick(null)
            handleZoneDrop(zone, filePath, filename)
          }}
          onCancel={() => {
            appendLog(pdfTypePick.filename, { ok: false, error: '已取消' })
            setPdfTypePick(null)
          }}
        />
      )}

      {angebotPreview && pendingAngebotFile && (
        <AngebotMatchModal
          filename={pendingAngebotFile.filename} preview={angebotPreview}
          selectedId={selectedAngebotId} onSelect={setSelectedAngebotId}
          onConfirm={handleConfirmAngebot} onCancel={handleCancelAngebot}
          confirmLoading={angebotConfirmLoading} />
      )}

      {rechnungPreview && pendingRechnungFile && (
        <RechnungMatchModal
          filename={pendingRechnungFile.filename} preview={rechnungPreview}
          selectionsByPos={rechnungSelections}
          onSelect={(posIdx, id) => setRechnungSelections(prev => ({ ...prev, [posIdx]: id }))}
          onConfirm={handleConfirmRechnung} onCancel={handleCancelRechnung}
          confirmLoading={rechnungConfirmLoading} />
      )}
    </div>
  )
}
