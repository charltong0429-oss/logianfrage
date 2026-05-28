import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { NotionRecord, InquiryStatus } from '../utils/types'
import { STATUS_COLORS } from '../utils/types'

type FilterTab = '全部' | '待询价' | '已询价' | '已报价' | '已确认' | '其他'
const TABS: FilterTab[] = ['全部', '待询价', '已询价', '已报价', '已确认', '其他']
const OTHER_STATUSES: InquiryStatus[] = ['已填表', '已要求提货', '已提货', '已收账单']
type ViewMode = 'list' | 'card'

const TYPE_BADGE: Record<string, string> = {
  INV:  'bg-blue-100 text-blue-700',
  BATT: 'bg-orange-100 text-orange-700',
  ACC:  'bg-purple-100 text-purple-700',
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

function StatusBadge({ status }: { status: InquiryStatus }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[status]}`}>
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

export default function ListPage() {
  const navigate = useNavigate()
  const [records, setRecords]   = useState<NotionRecord[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [tab, setTab]           = useState<FilterTab>('全部')
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    (localStorage.getItem('list_view_mode') as ViewMode) ?? 'list'
  )
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set())

  useEffect(() => { localStorage.setItem('list_view_mode', viewMode) }, [viewMode])

  async function loadRecords() {
    setLoading(true); setError('')
    const res = await window.api.getRecords()
    if (!res.ok) { setError(res.error ?? '加载失败'); setLoading(false); return }
    setRecords(res.records)
    const groups = groupByMonth(res.records)
    if (groups.length > 0) setExpandedMonths(new Set([groups[0].key]))
    setLoading(false)
  }

  useEffect(() => { loadRecords() }, [])

  const filtered = records.filter(r => {
    if (tab === '全部') return true
    if (tab === '其他') return (OTHER_STATUSES as string[]).includes(r.status)
    return r.status === tab
  })

  function countFor(t: FilterTab) {
    if (t === '全部') return records.length
    if (t === '其他') return records.filter(r => (OTHER_STATUSES as string[]).includes(r.status)).length
    return records.filter(r => r.status === t).length
  }

  function toggleMonth(key: string) {
    setExpandedMonths(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
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
          <button onClick={loadRecords} className="text-sm text-gray-500 hover:text-gray-800 px-3 py-1.5 rounded hover:bg-gray-100 transition-colors">刷新</button>
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
          <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-xs font-semibold text-red-700 mb-1">加载失败</p>
            <p className="text-sm text-red-600 font-mono break-all">{error}</p>
          </div>
        )}

        {!loading && !error && viewMode === 'card' && (
          <div className="mt-2">
            {filtered.length === 0
              ? <p className="text-center text-gray-400 py-12 text-sm">暂无记录</p>
              : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {filtered.map(r => (
                    <RecordCard key={r.notionPageId} record={r} onClick={() => navigate(`/detail/${r.notionPageId}`)} />
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
              const expanded = expandedMonths.has(key)
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
                      <table className="w-full text-sm" style={{ tableLayout: 'fixed', minWidth: 560 }}>
                        <colgroup>
                          <col style={{ width: 108 }} />
                          <col style={{ width: 160 }} />
                          <col style={{ width: 56 }} />
                          <col style={{ width: 90 }} />
                          <col style={{ width: 136 }} />
                        </colgroup>
                        <thead className="bg-gray-50 border-b border-gray-100">
                          <tr>
                            <th className="py-2 px-3 text-left text-xs font-medium text-gray-500">日期 / 货物</th>
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
                            return (
                              <React.Fragment key={r.notionPageId}>
                                <tr
                                  onClick={() => navigate(`/detail/${r.notionPageId}`)}
                                  className={`cursor-pointer transition-colors hover:bg-blue-50 ${show2 ? '' : 'border-b border-gray-100'}`}
                                >
                                  <td className="pt-2.5 pb-1 px-3 text-gray-700 tabular-nums">{r.date}</td>
                                  <td className="pt-2.5 pb-1 px-3"><StatusBadge status={r.status} /></td>
                                  <td className="pt-2.5 pb-1 px-3 font-bold text-gray-800">{r.country}</td>
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
                                {show2 && (
                                  <tr
                                    onClick={() => navigate(`/detail/${r.notionPageId}`)}
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
