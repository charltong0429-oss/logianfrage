import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../api/client'
import type { NotionRecord, InquiryStatus } from '../utils/types'
import { STATUS_COLORS } from '../utils/types'

type FilterTab = '全部' | InquiryStatus
const TABS: FilterTab[] = ['全部', '待询价', '已询价', '已报价', '要求出货', '已要求出货', '已收账单']
type ViewMode = 'list' | 'card'

const TYPE_BADGE: Record<string, string> = {
  INV:  'bg-blue-100 text-blue-700',
  BATT: 'bg-orange-100 text-orange-700',
  ACC:  'bg-purple-100 text-purple-700',
}

// ── Seen-record tracking (localStorage) ─────────────────────────────
const LS_SEEN      = 'liq_seen_v2'
const LS_NOTIFIED  = 'liq_notified_v2'   // v2: composite keys "${pageId}:${status}"
const POLL_INTERVAL = 3 * 60 * 1000      // 3 分钟轮询一次

function loadSeen(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(LS_SEEN) ?? '[]')) }
  catch { return new Set() }
}

function markSeen(id: string, current: Set<string>): Set<string> {
  const next = new Set(current)
  next.add(id)
  localStorage.setItem(LS_SEEN, JSON.stringify([...next]))
  return next
}

function loadNotified(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(LS_NOTIFIED) ?? '[]')) }
  catch { return new Set() }
}

function saveNotified(ids: Set<string>): void {
  localStorage.setItem(LS_NOTIFIED, JSON.stringify([...ids]))
}

async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  const result = await Notification.requestPermission()
  return result === 'granted'
}

// 每个需通知状态对应的标题与正文生成函数（S 端：外勤视角）
interface SlaveNotifConfig { title: string; body: (r: NotionRecord) => string }
const NOTIFY_STATUS_CONFIG: Record<string, SlaveNotifConfig> = {
  '已报价': {
    title: 'LogiAnfrage — 获得报价',
    body: (r) => {
      const pallets = r.pallets != null ? `${r.pallets}托` : ''
      const amount  = r.amount != null ? `，为 €${r.amount.toLocaleString('de-DE', { minimumFractionDigits: 2 })}` : ''
      return `${r.country} ${pallets}${r.type}，已获得报价${amount}`
    },
  },
  '已要求出货': {
    title: 'LogiAnfrage — 出货已安排',
    body: (r) => {
      const pallets = r.pallets != null ? `${r.pallets}托` : ''
      return `${r.country} ${pallets}${r.type}，出货订单已下单安排`
    },
  },
  '已要求提货': {
    title: 'LogiAnfrage — 出货已安排',
    body: (r) => {
      const pallets = r.pallets != null ? `${r.pallets}托` : ''
      return `${r.country} ${pallets}${r.type}，出货订单已下单安排`
    },
  },
}

function fireNotification(status: string, record: NotionRecord): void {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  const cfg = NOTIFY_STATUS_CONFIG[status]
  if (!cfg) return
  try { new Notification(cfg.title, { body: cfg.body(record), icon: '/favicon.ico' }) }
  catch { /* ignore – browser may block in some contexts */ }
}

// ── Helpers ──────────────────────────────────────────────────────────

function countryFlag(code: string): string {
  if (!code || code.length !== 2) return ''
  return code.toUpperCase().split('').map(c =>
    String.fromCodePoint(c.charCodeAt(0) + 0x1F1A5)
  ).join('')
}

function hasSecondRow(r: NotionRecord): boolean {
  return r.city != null || r.postalCode != null || r.pallets != null || r.rechnungAmount != null
}

function formatAmount(v: number | null): React.ReactNode {
  if (v == null) return <span className="text-gray-300 tabular-nums">—</span>
  return (
    <span className="font-semibold tabular-nums text-gray-800">
      € {v.toLocaleString('de-DE', { minimumFractionDigits: 2 })}
    </span>
  )
}

function groupByMonth(records: NotionRecord[]) {
  const map = new Map<string, NotionRecord[]>()
  for (const r of records) {
    const key = r.date.slice(0, 7)
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(r)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, rows]) => {
      const [y, m] = key.split('.')
      return { key, label: `${y} 年 ${Number(m)} 月`, rows }
    })
}

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-600'
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {status}
    </span>
  )
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-mono font-medium ${TYPE_BADGE[type] ?? 'bg-gray-100 text-gray-600'}`}>
      {type}
    </span>
  )
}

function RecordCard({ record, onClick }: { record: NotionRecord; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="bg-white border border-gray-200 rounded-xl p-4 cursor-pointer hover:border-blue-300 hover:shadow-sm transition-all"
    >
      <div className="flex items-center justify-between mb-2">
        <StatusBadge status={record.status} />
        <span className="text-xs text-gray-400 tabular-nums">{record.date}</span>
      </div>
      <div className="flex items-baseline gap-1.5 mb-1">
        <span className="text-2xl font-bold text-gray-800 leading-none">{record.country}</span>
        {record.city && <span className="text-xs text-gray-400 truncate max-w-[80px]">{record.city}</span>}
      </div>
      <div className="flex items-center gap-1.5 text-sm flex-wrap">
        {record.pallets != null && <span className="font-semibold text-gray-700">{record.pallets} 托</span>}
        {record.pallets != null && <span className="text-gray-300">·</span>}
        <TypeBadge type={record.type} />
        {record.weight != null && (
          <>
            <span className="text-gray-300">·</span>
            <span className="text-gray-400 text-xs">{record.weight} kg</span>
          </>
        )}
      </div>
      {record.rswCode && (
        <div className="mt-2 pt-2 border-t border-gray-100 text-xs text-orange-600 font-mono font-semibold">
          {record.rswCode}
        </div>
      )}
      {record.amount != null && (
        <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between">
          <span className="text-[10px] text-green-600 font-semibold uppercase tracking-wide">报价</span>
          <span className="text-base font-bold text-green-700 tabular-nums">
            € {record.amount.toLocaleString('de-DE', { minimumFractionDigits: 2 })}
          </span>
        </div>
      )}
    </div>
  )
}

interface DiagResult { ok: boolean; error?: string; env?: Record<string, unknown> }

export default function ListPage() {
  const navigate = useNavigate()
  const [records, setRecords]   = useState<NotionRecord[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [tab, setTab]           = useState<FilterTab>('全部')
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    (localStorage.getItem('list_view_mode') as ViewMode) ?? 'list'
  )
  // True accordion: only one month open at a time
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null)
  const [seenIds, setSeenIds]      = useState<Set<string>>(() => loadSeen())
  const [, setNotifiedIds] = useState<Set<string>>(() => loadNotified())
  const [diag, setDiag]            = useState<DiagResult | null>(null)
  const [diagLoading, setDiagLoading] = useState(false)

  useEffect(() => { localStorage.setItem('list_view_mode', viewMode) }, [viewMode])

  async function loadRecords(silent = false) {
    if (!silent) { setLoading(true); setError(''); setDiag(null) }
    try {
      const data = await apiFetch<NotionRecord[]>('/api/records')
      setRecords(data)
      const groups = groupByMonth(data)
      // Auto-open newest month if nothing is open yet
      if (groups.length > 0) setExpandedMonth(prev => prev ?? groups[0].key)

      // 通知：检测多种状态变化（未被通知过的条目）
      setNotifiedIds(prev => {
        let next = prev
        let changed = false
        for (const status of Object.keys(NOTIFY_STATUS_CONFIG)) {
          const toNotify = data.filter(
            r => r.status === status && !prev.has(`${r.notionPageId}:${status}`)
          )
          if (toNotify.length === 0) continue
          if (!changed) { next = new Set(prev); changed = true }
          toNotify.forEach(r => {
            fireNotification(status, r)
            next.add(`${r.notionPageId}:${status}`)
          })
        }
        if (changed) saveNotified(next)
        return next
      })
    } catch (e) {
      if (!silent) setError(String(e))
    } finally {
      if (!silent) setLoading(false)
    }
  }

  async function runDiag() {
    setDiagLoading(true); setDiag(null)
    try { setDiag(await apiFetch<DiagResult>('/api/test')) }
    catch (e) { setDiag({ ok: false, error: String(e) }) }
    finally { setDiagLoading(false) }
  }

  useEffect(() => {
    // 初次加载时请求通知权限
    requestNotificationPermission()
    loadRecords()
    // 定时轮询，静默刷新（不显示 loading 状态）
    const timer = setInterval(() => loadRecords(true), POLL_INTERVAL)
    return () => clearInterval(timer)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function matchesTab(status: string, t: FilterTab): boolean {
    if (t === '全部') return true
    if (t === '已要求出货') return status === '已要求出货' || status === '已要求提货'
    return status === t
  }

  const filtered = records.filter(r => matchesTab(r.status, tab))

  function countFor(t: FilterTab) {
    if (t === '全部') return records.length
    return records.filter(r => matchesTab(r.status, t)).length
  }

  function toggleMonth(key: string) {
    setExpandedMonth(prev => prev === key ? null : key)
  }

  function handleClickRecord(r: NotionRecord) {
    // Mark as seen before navigating
    if (r.status === '已报价') {
      setSeenIds(prev => markSeen(r.notionPageId, prev))
    }
    navigate(`/detail/${r.notionPageId}`)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-800">LogiAnfrage</h1>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 transition-colors ${viewMode === 'list' ? 'bg-gray-100 text-gray-800 font-medium' : 'text-gray-500 hover:bg-gray-50'}`}
            >列表</button>
            <button
              onClick={() => setViewMode('card')}
              className={`px-3 py-1.5 transition-colors ${viewMode === 'card' ? 'bg-gray-100 text-gray-800 font-medium' : 'text-gray-500 hover:bg-gray-50'}`}
            >卡片</button>
          </div>
          <button onClick={() => loadRecords()} className="text-sm text-gray-500 hover:text-gray-800 px-3 py-1.5 rounded hover:bg-gray-100 transition-colors">刷新</button>
          <button onClick={() => navigate('/new')} className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-lg font-medium transition-colors">+ 新建询价</button>
        </div>
      </header>

      <div className="px-6 pt-4 pb-2 flex items-center gap-2 flex-wrap">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${tab === t ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}
          >
            {t}{t !== '全部' && <span className="ml-1 opacity-70">({countFor(t)})</span>}
          </button>
        ))}
      </div>

      <div className="px-6 pb-6">
        {loading && <p className="text-sm text-gray-400 py-8 text-center">加载中…</p>}

        {error && (
          <div className="mt-4 space-y-3">
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-xs font-semibold text-red-700 mb-1">加载失败</p>
              <p className="text-sm text-red-600 font-mono break-all">{error}</p>
            </div>
            <button onClick={runDiag} disabled={diagLoading}
              className="text-sm bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 px-4 py-2 rounded-lg transition-colors">
              {diagLoading ? '诊断中…' : '🔍 运行连接诊断'}
            </button>
            {diag && (
              <div className={`border rounded-lg p-4 text-sm font-mono space-y-1 ${diag.ok ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'}`}>
                <p className={`font-semibold mb-2 ${diag.ok ? 'text-green-700' : 'text-yellow-700'}`}>
                  {diag.ok ? '✓ Notion 连接正常' : '✗ Notion 连接失败'}
                </p>
                {diag.env && Object.entries(diag.env).map(([k, v]) => (
                  <p key={k} className="text-xs text-gray-600">
                    <span className="text-gray-400">{k}：</span>
                    <span className={v === false ? 'text-red-600 font-bold' : 'text-gray-800'}>{String(v)}</span>
                  </p>
                ))}
                {diag.error && <p className="text-xs text-red-600 mt-2 break-all">{diag.error}</p>}
              </div>
            )}
          </div>
        )}

        {!loading && !error && viewMode === 'card' && (
          <div className="mt-2">
            {filtered.length === 0
              ? <p className="text-center text-gray-400 py-12 text-sm">暂无记录</p>
              : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {filtered.map(r => (
                    <RecordCard key={r.notionPageId} record={r} onClick={() => handleClickRecord(r)} />
                  ))}
                </div>
              )
            }
          </div>
        )}

        {!loading && !error && viewMode === 'list' && (
          <div className="mt-2 space-y-2">
            {filtered.length === 0 && <p className="text-center text-gray-400 py-12 text-sm">暂无记录</p>}
            {groupByMonth(filtered).map(({ key, label, rows }) => {
              const expanded = expandedMonth === key
              return (
                <div key={key} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <button
                    onClick={() => toggleMonth(key)}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors"
                  >
                    <span className={`text-xs text-gray-400 transition-transform duration-200 inline-block ${expanded ? 'rotate-90' : ''}`}>▶</span>
                    <span className="text-sm font-semibold text-gray-700">{label}</span>
                    <span className="text-xs text-gray-400">{rows.length} 条</span>
                  </button>

                  {expanded && (
                    <div className="border-t border-gray-100 overflow-x-auto">
                      <table className="w-full text-sm" style={{ tableLayout: 'fixed', minWidth: 580 }}>
                        <colgroup>
                          <col style={{ width: 130 }} />
                          <col style={{ width: 150 }} />
                          <col style={{ width: 52 }} />
                          <col style={{ width: 80 }} />
                          <col style={{ width: 136 }} />
                        </colgroup>
                        <thead className="bg-gray-50 border-b border-gray-100">
                          <tr>
                            <th className="py-2 px-3 text-left text-xs font-medium text-gray-500">日期 / Pickup#</th>
                            <th className="py-2 px-3 text-left text-xs font-medium text-gray-500">状态 / 地址</th>
                            <th className="py-2 px-3 text-left text-xs font-medium text-gray-500">国家</th>
                            <th className="py-2 px-3 text-right text-xs font-medium text-gray-500">重量</th>
                            <th className="py-2 px-3 text-right text-xs font-medium text-gray-500">报价 / 账单</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map(r => {
                            const show2 = hasSecondRow(r)
                            const cityPostal = [r.city, r.postalCode].filter(Boolean).join(', ')
                            // Breathing light: 已报价 and not yet seen
                            const needsAttention = r.status === '已报价' && !seenIds.has(r.notionPageId)
                            return (
                              <React.Fragment key={r.notionPageId}>
                                {/* 第一行 */}
                                <tr
                                  onClick={() => handleClickRecord(r)}
                                  className={`cursor-pointer transition-colors hover:bg-blue-50 ${show2 ? '' : 'border-b border-gray-100'}`}
                                >
                                  <td className="pt-2.5 pb-1 px-3">
                                    <div className="flex items-center gap-1.5">
                                      {needsAttention && (
                                        <span className="w-2 h-2 rounded-full bg-green-500 shrink-0 animate-pulse" title="新报价" />
                                      )}
                                      <span className="text-gray-700 tabular-nums">{r.date}</span>
                                    </div>
                                    {/* Pickup# prominently in first col */}
                                    {r.rswCode && (
                                      <div className="mt-0.5 text-xs font-mono font-semibold text-orange-600 leading-tight">
                                        {r.rswCode}
                                      </div>
                                    )}
                                  </td>
                                  <td className="pt-2.5 pb-1 px-3"><StatusBadge status={r.status} /></td>
                                  <td className="pt-2.5 pb-1 px-3 font-bold text-gray-800">
                                    <span>{countryFlag(r.country)} {r.country}</span>
                                  </td>
                                  <td className="pt-2.5 pb-1 px-3 text-right text-gray-600 tabular-nums">
                                    {r.weight != null ? `${r.weight} kg` : <span className="text-gray-300">—</span>}
                                  </td>
                                  <td className="pt-2.5 pb-1 px-3 text-right">
                                    <div className="flex flex-col items-end gap-0.5">
                                      <span className="text-[10px] text-gray-400 leading-none">报价</span>
                                      {formatAmount(r.amount)}
                                    </div>
                                  </td>
                                </tr>
                                {/* 第二行（有内容时才显示） */}
                                {show2 && (
                                  <tr
                                    onClick={() => handleClickRecord(r)}
                                    className="cursor-pointer transition-colors hover:bg-blue-50 border-b border-gray-100"
                                  >
                                    <td className="pt-0.5 pb-2 px-3">
                                      {r.pallets != null && (
                                        <span className="flex items-center gap-1.5">
                                          <span className="text-xs text-gray-500">{r.pallets} 托</span>
                                          <TypeBadge type={r.type} />
                                        </span>
                                      )}
                                    </td>
                                    <td className="pt-0.5 pb-2 px-3 text-xs text-gray-400 truncate">
                                      {cityPostal || null}
                                    </td>
                                    <td className="pt-0.5 pb-2 px-3" />
                                    <td className="pt-0.5 pb-2 px-3" />
                                    <td className="pt-0.5 pb-2 px-3 text-right">
                                      <div className="flex flex-col items-end gap-0.5">
                                        <span className="text-[10px] text-gray-400 leading-none">账单</span>
                                        {formatAmount(r.rechnungAmount)}
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
