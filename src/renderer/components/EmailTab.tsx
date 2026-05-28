import React, { useState, useEffect, useRef } from 'react'
import type { EmailConfig, EmailMessage, EmailDetail, NotionRecord } from '../utils/types'

interface MatchCandidate {
  notionPageId: string
  date: string
  type: string
  country: string
  postalCode: string | null
  city: string | null
  pallets: number | null
  weight: number | null
  volume: number | null
  status: string
  angebotnummer: string | null
  score: number
}

interface MatchState {
  attachIndex: number
  filename: string
  filePath: string
  pdfData: {
    angebotnummer: string | null
    amount: number | null
    destCountryCode: string | null
    destZip: string | null
    destCity: string | null
    pallets: number | null
    volume: number | null
    weight: number | null
  }
  candidates: MatchCandidate[]
}

interface Props {
  config: EmailConfig
}

export default function EmailTab({ config }: Props) {
  const [messages, setMessages] = useState<EmailMessage[]>([])
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [selectedMsg, setSelectedMsg] = useState<EmailMessage | null>(null)
  const [detail, setDetail] = useState<EmailDetail | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [matchLoading, setMatchLoading] = useState<number | null>(null)
  const [matchState, setMatchState] = useState<MatchState | null>(null)
  const [confirmLoading, setConfirmLoading] = useState<string | null>(null)
  const [importDone, setImportDone] = useState<string | null>(null)

  const [inquiries, setInquiries] = useState<NotionRecord[]>([])
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // DnD: drag email → drop on inquiry
  const [draggingMsg, setDraggingMsg] = useState<EmailMessage | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const [dropLoadingId, setDropLoadingId] = useState<string | null>(null)
  const [dropResult, setDropResult] = useState<{ id: string; msg: string } | null>(null)

  const configRef = useRef(config)
  configRef.current = config

  function doRefresh(clearFirst = false) {
    if (clearFirst) {
      setMessages([])
      setSelectedMsg(null)
      setDetail(null)
      setMatchState(null)
      setImportDone(null)
      setSavedAt(null)
    }
    setError(null)
    setRefreshing(true)
    window.api.emailFetchDachser(configRef.current).then(res => {
      if (res.ok) {
        setMessages(res.messages)
        setSavedAt(res.savedAt ?? null)
      } else {
        setError(res.error ?? '扫描失败')
      }
    }).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : '未知错误')
    }).finally(() => setRefreshing(false))
  }

  async function handleClearCache() {
    await window.api.emailClearCache()
    doRefresh(true)
  }

  useEffect(() => {
    // Load cache immediately (fast, no IMAP), then start incremental refresh
    window.api.emailGetCache().then(cache => {
      if (cache.messages.length > 0) {
        setMessages(cache.messages)
        setSavedAt(cache.savedAt)
      }
    }).catch(() => {})
    doRefresh(false)
    // Load inquiry list from Notion
    window.api.notionFetchRecords().then(res => {
      if (res.ok) {
        // Show active inquiries (not billed yet), sorted by date desc
        const active = res.records.filter(r => r.status !== '已收账单')
        active.sort((a, b) => b.date.localeCompare(a.date))
        setInquiries(active)
      }
    }).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function formatSavedAt(iso: string | null): string {
    if (!iso) return ''
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
    if (diff < 1) return '刚刚'
    if (diff < 60) return `${diff}分钟前`
    const h = Math.floor(diff / 60)
    if (h < 24) return `${h}小时前`
    return `${Math.floor(h / 24)}天前`
  }

  async function handleSelectMessage(msg: EmailMessage) {
    if (selectedMsg?.uid === msg.uid && selectedMsg?.folder === msg.folder) return
    setSelectedMsg(msg)
    setDetail(null)
    setMatchState(null)
    setImportDone(null)
    setLoadingDetail(true)
    const res = await window.api.emailFetchDetail(config, msg.uid, msg.folder)
    setLoadingDetail(false)
    if (res.ok && res.detail) setDetail(res.detail)
  }

  async function handleImportAttachment(attachIndex: number, filename: string) {
    if (!selectedMsg) return
    setMatchLoading(attachIndex)
    setMatchState(null)
    setImportDone(null)

    const saved = await window.api.emailSaveAttachment(config, selectedMsg.uid, attachIndex, selectedMsg.folder)
    if (!saved.ok || !saved.filePath) {
      setMatchLoading(null)
      setImportDone(`❌ 保存失败：${saved.error}`)
      return
    }

    const res = await window.api.previewAngebotMatch(saved.filePath)
    setMatchLoading(null)

    if (!res.ok) {
      setImportDone(`❌ 解析失败：${res.error ?? '未能识别报价单'}`)
      return
    }

    setMatchState({
      attachIndex,
      filename,
      filePath: saved.filePath,
      pdfData: res.pdfData,
      candidates: res.candidates,
    })
  }

  async function handleConfirm(notionPageId: string) {
    if (!matchState) return
    setConfirmLoading(notionPageId)

    const res = await window.api.confirmAngebotImport({
      filePath: matchState.filePath,
      notionPageId,
      pdfData: matchState.pdfData,
    })
    setConfirmLoading(null)

    if (res.ok) {
      setImportDone(`✓ 已关联：${res.record?.date ?? ''} ${res.record?.type ?? ''} ${res.record?.country ?? ''}`)
      setMatchState(null)
    } else {
      setImportDone(`❌ 关联失败：${res.error}`)
    }
  }

  function formatDate(iso: string) {
    if (!iso) return ''
    const d = new Date(iso)
    return `${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  }

  function isSent(msg: EmailMessage) {
    return !msg.from.toLowerCase().includes('dachser')
  }

  function countryFlag(code: string): string {
    if (!code || code.length !== 2) return ''
    return code.toUpperCase().split('').map(c => String.fromCodePoint(c.charCodeAt(0) + 0x1F1A5)).join('')
  }

  const STATUS_CLS: Record<string, string> = {
    '待询价': 'bg-blue-100 text-blue-700',
    '已询价': 'bg-yellow-100 text-yellow-700',
    '已报价': 'bg-green-100 text-green-700',
    '已要求提货': 'bg-orange-100 text-orange-700',
  }

  function handleInquiryMouseEnter(id: string) {
    hoverTimerRef.current = setTimeout(() => setHoveredId(id), 3000)
  }

  function handleInquiryMouseLeave() {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    setHoveredId(null)
  }

  async function handleDropEmailOnInquiry(msg: EmailMessage, notionPageId: string) {
    setDropTargetId(null)
    setDraggingMsg(null)
    setDropLoadingId(notionPageId)
    setDropResult(null)

    const detailRes = await window.api.emailFetchDetail(configRef.current, msg.uid, msg.folder)
    if (!detailRes.ok || !detailRes.detail) {
      setDropLoadingId(null)
      setDropResult({ id: notionPageId, msg: '❌ 无法加载邮件详情' })
      setTimeout(() => setDropResult(null), 4000)
      return
    }

    const pdfAtts = detailRes.detail.attachments.filter(a => a.filename.toLowerCase().endsWith('.pdf'))
    if (pdfAtts.length === 0) {
      setDropLoadingId(null)
      setDropResult({ id: notionPageId, msg: '❌ 邮件没有 PDF 附件' })
      setTimeout(() => setDropResult(null), 4000)
      return
    }

    // Prefer Preisangebot PDF; fall back to first PDF
    const target = pdfAtts.find(a => /preisangebot/i.test(a.filename)) ?? pdfAtts[0]
    const saved = await window.api.emailSaveAttachment(configRef.current, msg.uid, target.index, msg.folder)
    if (!saved.ok || !saved.filePath) {
      setDropLoadingId(null)
      setDropResult({ id: notionPageId, msg: `❌ 保存失败` })
      setTimeout(() => setDropResult(null), 4000)
      return
    }

    const matchRes = await window.api.previewAngebotMatch(saved.filePath)
    if (!matchRes.ok) {
      setDropLoadingId(null)
      setDropResult({ id: notionPageId, msg: '❌ PDF 解析失败' })
      setTimeout(() => setDropResult(null), 4000)
      return
    }

    const importRes = await window.api.confirmAngebotImport({
      filePath: saved.filePath,
      notionPageId,
      pdfData: matchRes.pdfData,
    })
    setDropLoadingId(null)

    if (importRes.ok) {
      setDropResult({ id: notionPageId, msg: '✓ 已关联' })
      window.api.notionFetchRecords().then(res => {
        if (res.ok) {
          const active = res.records.filter(r => r.status !== '已收账单')
          active.sort((a, b) => b.date.localeCompare(a.date))
          setInquiries(active)
        }
      }).catch(() => {})
    } else {
      setDropResult({ id: notionPageId, msg: `❌ ${importRes.error ?? '关联失败'}` })
    }
    setTimeout(() => setDropResult(null), 4000)
  }

  return (
    <div className="flex h-full min-h-0">
      {/* ── 询价列表（左侧，悬停3秒显示详情，可作为拖放目标）── */}
      {inquiries.length > 0 && (
        <div className="w-40 shrink-0 border-r border-gray-200 flex flex-col min-h-0 bg-gray-50">
          <div className="px-2 py-2 border-b border-gray-200 bg-gray-100">
            <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">询价记录</span>
            {draggingMsg && (
              <p className="text-[9px] text-blue-500 mt-0.5">拖入以关联报价单</p>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {inquiries.map(r => {
              const isHovered = hoveredId === r.notionPageId && !draggingMsg
              const isDropTarget = dropTargetId === r.notionPageId
              const isLoading = dropLoadingId === r.notionPageId
              const result = dropResult?.id === r.notionPageId ? dropResult.msg : null
              return (
                <div
                  key={r.notionPageId}
                  className={`relative px-2 py-2 border-b border-gray-100 cursor-default transition-colors ${
                    isDropTarget ? 'bg-blue-100 border-blue-300 border-2' :
                    isLoading ? 'bg-blue-50' :
                    'hover:bg-white'
                  }`}
                  onMouseEnter={() => { if (!draggingMsg) handleInquiryMouseEnter(r.notionPageId) }}
                  onMouseLeave={() => { handleInquiryMouseLeave(); setDropTargetId(null) }}
                  onDragOver={(e) => { e.preventDefault(); if (draggingMsg) setDropTargetId(r.notionPageId) }}
                  onDragLeave={() => setDropTargetId(null)}
                  onDrop={(e) => { e.preventDefault(); if (draggingMsg) handleDropEmailOnInquiry(draggingMsg, r.notionPageId) }}
                >
                  {isLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-blue-50/90 z-10 rounded">
                      <span className="text-[10px] text-blue-600 font-medium">导入中…</span>
                    </div>
                  )}
                  {result && (
                    <div className={`absolute inset-0 flex items-center justify-center z-10 rounded text-[10px] font-medium px-1 text-center ${
                      result.startsWith('✓') ? 'bg-green-50/95 text-green-700' : 'bg-red-50/95 text-red-700'
                    }`}>
                      {result}
                    </div>
                  )}
                  {/* compact row */}
                  <div className="flex items-center gap-1 mb-0.5">
                    <span className="text-sm leading-none">{countryFlag(r.country)}</span>
                    <span className="text-[10px] font-semibold text-gray-700">{r.country}</span>
                    <span className={`text-[9px] px-1 py-0.5 rounded font-medium ${STATUS_CLS[r.status] ?? 'bg-gray-100 text-gray-500'}`}>{r.status.replace('已', '')}</span>
                  </div>
                  <div className="text-[10px] text-gray-500">{r.date.slice(5)}</div>
                  <div className="flex items-center gap-1 mt-0.5">
                    {r.pallets != null && <span className="text-[10px] text-gray-600">{r.pallets}托</span>}
                    <span className="text-[9px] bg-gray-200 text-gray-600 px-1 rounded">{r.type}</span>
                  </div>
                  {r.rswCode && (
                    <div className="text-[10px] font-mono text-orange-600 mt-0.5 truncate">{r.rswCode}</div>
                  )}
                  {/* drop target highlight */}
                  {isDropTarget && (
                    <div className="absolute inset-0 border-2 border-blue-400 rounded pointer-events-none flex items-center justify-center">
                      <span className="text-[10px] font-semibold text-blue-600 bg-white/90 px-1.5 py-0.5 rounded">放开以关联</span>
                    </div>
                  )}
                  {/* 悬停3秒显示详情tooltip */}
                  {isHovered && (
                    <div className="absolute left-full top-0 z-50 ml-1 w-56 bg-white border border-gray-200 rounded-lg shadow-xl p-3 text-xs">
                      <div className="font-semibold text-gray-800 mb-2">
                        {countryFlag(r.country)} {r.country} · {r.date}
                      </div>
                      <div className="space-y-1 text-gray-600">
                        <div><span className="text-gray-400">类型：</span>{r.type}</div>
                        {r.pallets != null && <div><span className="text-gray-400">托盘：</span>{r.pallets} 托</div>}
                        {r.weight != null && <div><span className="text-gray-400">重量：</span>{r.weight} kg</div>}
                        {(r.postalCode || r.city) && (
                          <div><span className="text-gray-400">地址：</span>{[r.postalCode, r.city].filter(Boolean).join(' ')}</div>
                        )}
                        {r.angebotnummer && <div><span className="text-gray-400">报价单：</span>{r.angebotnummer}</div>}
                        {r.amount != null && <div><span className="text-gray-400">报价：</span>€{r.amount.toLocaleString()}</div>}
                        {r.rswCode && <div><span className="text-gray-400">Pickup#：</span><span className="font-mono text-orange-600">{r.rswCode}</span></div>}
                        <div className="mt-1"><span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_CLS[r.status] ?? 'bg-gray-100 text-gray-500'}`}>{r.status}</span></div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── 邮件列表 ── */}
      <div className="w-72 shrink-0 border-r border-gray-200 flex flex-col min-h-0 bg-white">
        <div className="px-3 py-2 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">
              Dachser 往来邮件
              {messages.length > 0 && (
                <span className="ml-1 text-xs text-gray-400">({messages.length})</span>
              )}
            </span>
            <div className="flex items-center gap-2">
              {refreshing && (
                <span className="text-[10px] text-blue-400 animate-pulse">增量扫描中…</span>
              )}
              <button
                onClick={() => doRefresh(false)}
                disabled={refreshing}
                className="text-xs text-blue-500 hover:text-blue-700 disabled:text-gray-400 transition-colors"
              >
                刷新
              </button>
            </div>
          </div>
          {savedAt && (
            <div className="flex items-center justify-between mt-0.5">
              <span className="text-[10px] text-gray-400">上次扫描：{formatSavedAt(savedAt)}</span>
              <button
                onClick={handleClearCache}
                disabled={refreshing}
                className="text-[10px] text-gray-400 hover:text-red-500 disabled:text-gray-300 transition-colors"
              >
                清空缓存
              </button>
            </div>
          )}
        </div>

        {error && (
          <div className="px-3 py-2 text-xs text-red-600 bg-red-50 border-b border-red-200">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {messages.map(msg => {
            const sent = isSent(msg)
            const isSelected = selectedMsg?.uid === msg.uid && selectedMsg?.folder === msg.folder
            const isDragging = draggingMsg?.uid === msg.uid && draggingMsg?.folder === msg.folder
            return (
              <div
                key={`${msg.folder}:${msg.uid}`}
                draggable={msg.hasAttachment}
                onClick={() => handleSelectMessage(msg)}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'copy'
                  setDraggingMsg(msg)
                }}
                onDragEnd={() => { setDraggingMsg(null); setDropTargetId(null) }}
                title={msg.hasAttachment ? '拖到左侧询价记录以关联报价单' : undefined}
                className={`px-3 py-2.5 cursor-pointer border-b border-gray-100 transition-colors ${
                  isDragging ? 'opacity-50 bg-blue-50' :
                  isSelected ? 'bg-blue-50 border-l-2 border-l-blue-500' : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <div className="flex items-center gap-1 min-w-0 flex-1">
                    {sent ? (
                      <span className="text-[10px] text-blue-500 font-medium shrink-0">→</span>
                    ) : (
                      <span className="text-[10px] text-green-500 font-medium shrink-0">←</span>
                    )}
                    <span className={`text-xs truncate ${msg.seen ? 'text-gray-500' : 'font-semibold text-gray-800'}`}>
                      {sent ? 'To Dachser' : msg.from.split('<')[0].trim() || 'Dachser'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {msg.hasAttachment && (
                      <span className="text-gray-400 text-[10px]" title="拖到左侧询价记录以关联">📎⠿</span>
                    )}
                    <span className="text-[10px] text-gray-400 whitespace-nowrap">{formatDate(msg.date)}</span>
                  </div>
                </div>
                <p className={`text-xs mt-0.5 truncate pl-3 ${msg.seen ? 'text-gray-400' : 'text-gray-700'}`}>
                  {msg.subject}
                </p>
              </div>
            )
          })}
          {messages.length === 0 && !refreshing && !error && (
            <div className="py-12 text-center text-sm text-gray-400">暂无 Dachser 往来邮件</div>
          )}
        </div>
      </div>

      {/* ── 详情 ── */}
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col bg-white">
        {!selectedMsg && !loadingDetail && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-gray-400">选择一封邮件查看详情</p>
          </div>
        )}
        {loadingDetail && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-gray-400">加载中…</p>
          </div>
        )}

        {detail && (
          <>
            <div className="px-5 py-3.5 border-b border-gray-200 bg-gray-50 shrink-0">
              <div className="flex items-center gap-2 mb-0.5">
                {selectedMsg && isSent(selectedMsg) ? (
                  <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">已发</span>
                ) : (
                  <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-medium">收件</span>
                )}
                <h2 className="text-sm font-semibold text-gray-900">{detail.subject}</h2>
              </div>
              <div className="flex items-center gap-3 text-xs text-gray-500">
                <span>{detail.from}</span>
                <span>{detail.date ? new Date(detail.date).toLocaleString('zh-CN') : ''}</span>
                {selectedMsg && (
                  <span className="text-gray-300">📁 {selectedMsg.folder}</span>
                )}
              </div>
            </div>

            {detail.attachments.length > 0 && (
              <div className="px-5 py-3 border-b border-amber-200 bg-amber-50 shrink-0">
                <p className="text-xs font-medium text-amber-800 mb-2">
                  附件（{detail.attachments.length} 个）
                </p>
                <div className="flex flex-wrap gap-2">
                  {detail.attachments.map(att => (
                    <div
                      key={att.index}
                      className="flex items-center gap-2 bg-white border border-amber-200 rounded-lg px-3 py-2 shadow-sm"
                    >
                      <span className="text-sm">📄</span>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-gray-800 truncate max-w-[200px]">{att.filename}</p>
                        <p className="text-[10px] text-gray-400">{Math.round(att.size / 1024)} KB</p>
                      </div>
                      {att.filename.toLowerCase().endsWith('.pdf') && (
                        <button
                          onClick={() => handleImportAttachment(att.index, att.filename)}
                          disabled={matchLoading === att.index}
                          className="ml-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded px-2.5 py-1 transition-colors whitespace-nowrap"
                        >
                          {matchLoading === att.index ? '解析中…' : '导入询价'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {importDone && (
                  <div className={`mt-3 text-xs px-3 py-2 rounded border ${
                    importDone.startsWith('✓')
                      ? 'bg-green-50 border-green-200 text-green-700'
                      : 'bg-red-50 border-red-200 text-red-700'
                  }`}>
                    {importDone}
                  </div>
                )}

                {matchState && (
                  <div className="mt-3 bg-white border border-blue-200 rounded-lg overflow-hidden">
                    <div className="px-3 py-2 bg-blue-50 border-b border-blue-200">
                      <p className="text-xs font-semibold text-blue-800">
                        报价单匹配 — {matchState.pdfData.angebotnummer ?? '未识别编号'}
                        {matchState.pdfData.amount != null && (
                          <span className="ml-2 text-blue-600">€{matchState.pdfData.amount.toLocaleString()}</span>
                        )}
                        {matchState.pdfData.destCountryCode && (
                          <span className="ml-2 text-gray-500">
                            → {matchState.pdfData.destCountryCode}
                            {matchState.pdfData.destZip ? `-${matchState.pdfData.destZip}` : ''}
                          </span>
                        )}
                      </p>
                    </div>
                    {matchState.candidates.length === 0 ? (
                      <p className="px-3 py-3 text-xs text-gray-500">未找到匹配的询价记录</p>
                    ) : (
                      <div className="divide-y divide-gray-100">
                        {matchState.candidates.slice(0, 5).map(c => (
                          <div key={c.notionPageId} className="flex items-center gap-3 px-3 py-2">
                            <div className="flex-1 min-w-0">
                              <span className="text-xs font-medium text-gray-800">
                                {c.date} · {c.type} · {c.country}
                              </span>
                              {(c.city || c.postalCode) && (
                                <span className="ml-2 text-xs text-gray-500">
                                  {[c.postalCode, c.city].filter(Boolean).join(' ')}
                                </span>
                              )}
                              <span className={`ml-2 inline-block text-[10px] px-1.5 py-0.5 rounded-full ${
                                c.score >= 4 ? 'bg-green-100 text-green-700' :
                                c.score >= 2 ? 'bg-yellow-100 text-yellow-700' :
                                'bg-gray-100 text-gray-500'
                              }`}>
                                {c.score >= 4 ? '高匹配' : c.score >= 2 ? '中匹配' : '低匹配'}
                              </span>
                            </div>
                            <button
                              onClick={() => handleConfirm(c.notionPageId)}
                              disabled={confirmLoading != null}
                              className="text-xs bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white rounded px-2.5 py-1 transition-colors whitespace-nowrap"
                            >
                              {confirmLoading === c.notionPageId ? '关联中…' : '确认关联'}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {detail.bodyHtml ? (
                <div
                  className="text-sm text-gray-700 leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: detail.bodyHtml }}
                />
              ) : detail.bodyText ? (
                <pre className="text-xs text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
                  {detail.bodyText}
                </pre>
              ) : (
                <p className="text-sm text-gray-400">邮件正文为空</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
