import React, { useEffect, useState, useCallback } from 'react'
import type { NotionRecord, InquiryStatus } from '../utils/types'
import { INQUIRY_STATUSES } from '../utils/types'

interface Stats {
  total: number
  active: number
  quotedCount: number
  totalQuoted: number
  byStatus: Record<InquiryStatus, number>
  byCountry: Array<{ country: string; count: number }>
  byType: { INV: number; BATT: number; ACC: number }
  monthly: Array<{ label: string; count: number }>
  recent: NotionRecord[]
}

const STATUS_COLOR: Record<InquiryStatus, string> = {
  '待询价':     '#fbbf24',
  '已询价':     '#60a5fa',
  '已报价':     '#34d399',
  '已要求提货': '#fb923c',
  '已收账单':   '#c084fc',
}

const STATUS_EN: Record<InquiryStatus, string> = {
  '待询价':     'PENDING',
  '已询价':     'INQUIRED',
  '已报价':     'QUOTED',
  '已要求提货': 'PICKUP REQ',
  '已收账单':   'INVOICED',
}

function computeStats(records: NotionRecord[]): Stats {
  const byStatus: Record<string, number> = {}
  for (const s of INQUIRY_STATUSES) byStatus[s] = 0

  const countryMap: Record<string, number> = {}
  const typeCount = { INV: 0, BATT: 0, ACC: 0 }
  let totalQuoted = 0
  let quotedCount = 0
  let active = 0

  const now = new Date()
  const monthlyMap: Record<string, number> = {}
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`
    monthlyMap[key] = 0
  }

  for (const r of records) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1
    countryMap[r.country] = (countryMap[r.country] || 0) + 1
    typeCount[r.type] = (typeCount[r.type] || 0) + 1
    if (r.amount !== null) { totalQuoted += r.amount; quotedCount++ }
    if (r.status !== '已收账单') active++
    const parts = r.date.split('.')
    if (parts.length >= 2) {
      const key = `${parts[0]}.${parts[1]}`
      if (key in monthlyMap) monthlyMap[key]++
    }
  }

  const byCountry = Object.entries(countryMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7)
    .map(([country, count]) => ({ country, count }))

  const monthly = Object.entries(monthlyMap).map(([key, count]) => {
    const [, month] = key.split('.')
    return { label: `${parseInt(month)}M`, count }
  })

  const recent = [...records]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10)

  return {
    total: records.length,
    active,
    quotedCount,
    totalQuoted,
    byStatus: byStatus as Record<InquiryStatus, number>,
    byCountry,
    byType: typeCount,
    monthly,
    recent,
  }
}

function Panel({ children, color = '#1e3a5f', title, className = '', innerClass = '' }: {
  children: React.ReactNode
  color?: string
  title?: string
  className?: string
  innerClass?: string
}) {
  return (
    <div
      className={`relative flex flex-col min-h-0 overflow-hidden ${className}`}
      style={{
        background: 'rgba(6, 16, 30, 0.95)',
        border: `1px solid ${color}44`,
        boxShadow: `0 0 20px ${color}18, inset 0 0 20px ${color}06`,
        borderRadius: 3,
      }}
    >
      {/* Corner brackets */}
      <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2" style={{ borderColor: color }} />
      <div className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2" style={{ borderColor: color }} />
      <div className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2" style={{ borderColor: color }} />
      <div className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2" style={{ borderColor: color }} />

      {title && (
        <div className="px-3 pt-2 shrink-0">
          <span className="text-[9px] font-bold tracking-widest uppercase" style={{ color: color + 'cc' }}>{title}</span>
          <div className="mt-1 h-px w-full opacity-20" style={{ background: color }} />
        </div>
      )}
      <div className={`flex-1 min-h-0 px-3 pb-2 pt-2 ${innerClass}`}>
        {children}
      </div>
    </div>
  )
}

function KpiCard({ label, value, unit, sub, color }: {
  label: string; value: string; unit?: string; sub?: string; color: string
}) {
  return (
    <Panel color={color} className="flex-1">
      <div className="flex flex-col justify-between h-full py-1">
        <span className="text-[9px] font-bold tracking-widest uppercase text-slate-400">{label}</span>
        <div className="flex items-end gap-1 min-w-0">
          {unit && (
            <span className="text-lg font-bold mb-1 shrink-0" style={{ color, opacity: 0.8 }}>{unit}</span>
          )}
          <span
            className="font-mono font-bold leading-none truncate"
            style={{ color, fontSize: '2rem', textShadow: `0 0 20px ${color}80` }}
          >
            {value}
          </span>
        </div>
        {sub && <span className="text-[8px] text-slate-500 tracking-wider uppercase">{sub}</span>}
      </div>
    </Panel>
  )
}

function Bar({ pct, color, glow = true }: { pct: number; color: string; glow?: boolean }) {
  return (
    <div className="flex-1 h-full rounded-sm overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
      <div
        className="h-full rounded-sm transition-all duration-700"
        style={{
          width: `${Math.max(pct, pct > 0 ? 3 : 0)}%`,
          background: color,
          boxShadow: glow && pct > 0 ? `0 0 8px ${color}90` : 'none',
        }}
      />
    </div>
  )
}

export default function PilotView() {
  const [records, setRecords] = useState<NotionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [now, setNow] = useState(new Date())
  const [blink, setBlink] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.api.notionFetchRecords()
      if (result.ok) {
        setRecords(result.records)
        setLastRefresh(new Date())
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [load])

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const id = setInterval(() => setBlink(b => !b), 700)
    return () => clearInterval(id)
  }, [])

  const stats = computeStats(records)
  const maxStatus  = Math.max(...INQUIRY_STATUSES.map(s => stats.byStatus[s]), 1)
  const maxCountry = Math.max(...stats.byCountry.map(c => c.count), 1)
  const maxMonthly = Math.max(...stats.monthly.map(m => m.count), 1)
  const quoteRatePct = stats.total > 0 ? Math.round(stats.quotedCount / stats.total * 100) : 0

  const clockStr = now.toTimeString().slice(0, 8)
  const dateStr  = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`

  const totalQuotedStr = stats.totalQuoted >= 100_000
    ? `${(stats.totalQuoted / 1000).toFixed(1)}K`
    : stats.totalQuoted.toLocaleString('de-DE', { minimumFractionDigits: 2 })

  return (
    <div
      className="h-full flex flex-col overflow-hidden select-none"
      style={{ background: '#020b14', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, "SF Mono", monospace' }}
    >
      {/* ── Header ── */}
      <div
        className="shrink-0 flex items-center justify-between px-4"
        style={{ height: 38, borderBottom: '1px solid #0d2237', background: 'rgba(3,12,28,0.9)' }}
      >
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div
              className="w-2 h-2 rounded-full"
              style={{
                background: blink ? '#22c55e' : '#14532d',
                boxShadow: blink ? '0 0 10px #22c55e, 0 0 20px #16a34a50' : 'none',
                transition: 'all 0.3s ease',
              }}
            />
            <span className="text-[9px] font-bold tracking-widest" style={{ color: '#4ade80' }}>LIVE</span>
          </div>
          <div className="h-3 w-px" style={{ background: '#1e3a5f' }} />
          <span className="text-[11px] font-bold tracking-[0.2em] text-slate-300">LOGISTIC MISSION CONTROL</span>
        </div>

        <div className="flex items-center gap-5">
          {lastRefresh && (
            <span className="text-[8px] tracking-wider" style={{ color: '#2d4a63' }}>
              LAST SYNC {lastRefresh.toTimeString().slice(0, 8)}
            </span>
          )}
          <span className="text-[9px] tracking-widest" style={{ color: '#0ea5e9' }}>{dateStr}</span>
          <span
            className="text-sm font-bold tabular-nums tracking-widest"
            style={{ color: '#67e8f9', textShadow: '0 0 16px #22d3ee60' }}
          >
            {clockStr}
          </span>
          <button
            onClick={load}
            disabled={loading}
            className="text-[9px] tracking-widest font-bold px-2.5 py-0.5 rounded-sm transition-colors"
            style={{
              border: '1px solid #1e3a5f',
              color: loading ? '#2d4a63' : '#60a5fa',
              background: 'rgba(30,64,175,0.12)',
            }}
          >
            {loading ? '···' : '↻ SYNC'}
          </button>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 min-h-0 p-2.5 grid gap-2.5" style={{ gridTemplateRows: '88px 1fr 1fr' }}>

        {/* ── KPI Row ── */}
        <div className="flex gap-2.5">
          <KpiCard label="总记录" value={String(stats.total)} sub="ALL RECORDS" color="#22d3ee" />
          <KpiCard label="进行中" value={String(stats.active)} sub="IN PIPELINE" color="#34d399" />
          <KpiCard label="报价率" value={`${quoteRatePct}%`} sub={`${stats.quotedCount} WITH PRICE`} color="#fbbf24" />
          <KpiCard label="报价总额" unit="€" value={totalQuotedStr} sub="QUOTED TOTAL" color="#c084fc" />
        </div>

        {/* ── Middle Row ── */}
        <div className="grid gap-2.5 min-h-0" style={{ gridTemplateColumns: '2fr 1.4fr 1.4fr' }}>

          {/* Status Pipeline */}
          <Panel color="#22d3ee" title="STATUS PIPELINE">
            <div className="flex flex-col gap-1.5 h-full">
              {INQUIRY_STATUSES.map(s => {
                const count = stats.byStatus[s]
                return (
                  <div key={s} className="flex items-center gap-2 flex-1">
                    <span
                      className="text-[8px] font-bold tracking-wider shrink-0"
                      style={{ color: STATUS_COLOR[s], width: 70 }}
                    >
                      {STATUS_EN[s]}
                    </span>
                    <div className="flex-1 h-3 rounded-sm overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
                      <div
                        className="h-full rounded-sm transition-all duration-700"
                        style={{
                          width: `${count / maxStatus * 100}%`,
                          background: STATUS_COLOR[s],
                          boxShadow: count > 0 ? `0 0 6px ${STATUS_COLOR[s]}90` : 'none',
                        }}
                      />
                    </div>
                    <span
                      className="text-[10px] font-bold shrink-0 tabular-nums"
                      style={{ color: STATUS_COLOR[s], width: 16, textAlign: 'right' }}
                    >
                      {count}
                    </span>
                  </div>
                )
              })}
            </div>
          </Panel>

          {/* Top Destinations */}
          <Panel color="#60a5fa" title="TOP DESTINATIONS">
            <div className="flex flex-col gap-2 h-full">
              {stats.byCountry.map(({ country, count }) => (
                <div key={country} className="flex items-center gap-2 flex-1">
                  <span className="text-[10px] font-bold text-slate-200 shrink-0 w-5">{country}</span>
                  <Bar pct={count / maxCountry * 100} color="#3b82f6" />
                  <span className="text-[9px] font-bold text-blue-300 shrink-0 w-4 text-right tabular-nums">{count}</span>
                </div>
              ))}
            </div>
          </Panel>

          {/* Cargo Mix */}
          <Panel color="#fb923c" title="CARGO MIX">
            <div className="flex flex-col justify-around h-full gap-3">
              {(['INV', 'BATT', 'ACC'] as const).map(t => {
                const count = stats.byType[t]
                const pct   = stats.total > 0 ? count / stats.total * 100 : 0
                const colors = { INV: '#22d3ee', BATT: '#fbbf24', ACC: '#fb923c' }
                const c = colors[t]
                const labels = { INV: 'INVERTER', BATT: 'BATTERY', ACC: 'ACCESSORY' }
                return (
                  <div key={t} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-[9px] font-bold tracking-widest" style={{ color: c }}>{t}</span>
                        <span className="text-[7px] text-slate-500 ml-1 tracking-wider">{labels[t]}</span>
                      </div>
                      <span className="text-[10px] font-bold tabular-nums" style={{ color: c }}>{count}</span>
                    </div>
                    <div className="h-2.5 rounded-sm overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
                      <div
                        className="h-full rounded-sm transition-all duration-700"
                        style={{
                          width: `${pct}%`,
                          background: c,
                          boxShadow: count > 0 ? `0 0 8px ${c}80` : 'none',
                        }}
                      />
                    </div>
                    <span className="text-[7px] tracking-wider" style={{ color: '#2d4a63' }}>{pct.toFixed(0)}% OF TOTAL</span>
                  </div>
                )
              })}
            </div>
          </Panel>
        </div>

        {/* ── Bottom Row ── */}
        <div className="grid gap-2.5 min-h-0" style={{ gridTemplateColumns: '3fr 2fr' }}>

          {/* Monthly Throughput */}
          <Panel color="#a855f7" title="MONTHLY THROUGHPUT">
            <div className="flex items-end gap-2" style={{ height: '100%' }}>
              {stats.monthly.map(({ label, count }, i) => (
                <div key={i} className="flex-1 flex flex-col items-center" style={{ height: '100%' }}>
                  <span
                    className="shrink-0 text-[9px] font-bold tabular-nums"
                    style={{ color: count > 0 ? '#d8b4fe' : 'transparent', marginBottom: 2 }}
                  >
                    {count}
                  </span>
                  <div className="flex-1 w-full relative rounded-t-sm" style={{ background: 'rgba(255,255,255,0.04)' }}>
                    <div
                      className="absolute bottom-0 w-full rounded-t-sm transition-all duration-700"
                      style={{
                        height: `${maxMonthly > 0 ? count / maxMonthly * 100 : 0}%`,
                        background: count > 0
                          ? 'linear-gradient(180deg, #e879f9 0%, #7c3aed 100%)'
                          : 'transparent',
                        boxShadow: count > 0 ? '0 0 10px #a855f770' : 'none',
                      }}
                    />
                  </div>
                  <span className="shrink-0 text-[8px] tracking-wider mt-1" style={{ color: '#2d4a63' }}>{label}</span>
                </div>
              ))}
            </div>
          </Panel>

          {/* Recent Activity */}
          <Panel color="#34d399" title="RECENT ACTIVITY">
            <div className="flex flex-col gap-1 overflow-hidden h-full">
              {stats.recent.map((r) => (
                <div
                  key={r.notionPageId}
                  className="flex items-center gap-1.5 shrink-0"
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: 3 }}
                >
                  <span className="text-[8px] shrink-0 tabular-nums" style={{ color: '#1e4a63', width: 60 }}>{r.date}</span>
                  <span className="text-[8px] font-bold shrink-0 text-slate-400 w-7">{r.type}</span>
                  <span className="text-[8px] shrink-0 text-slate-500 w-4">{r.country}</span>
                  <span
                    className="text-[8px] font-bold tracking-wider flex-1 truncate"
                    style={{ color: STATUS_COLOR[r.status] }}
                  >
                    {STATUS_EN[r.status]}
                  </span>
                  {r.amount !== null
                    ? <span className="text-[8px] font-bold shrink-0 tabular-nums" style={{ color: '#34d399' }}>
                        €{r.amount.toLocaleString('de-DE', { minimumFractionDigits: 0 })}
                      </span>
                    : <span className="text-[8px] shrink-0" style={{ color: '#1e3a5f', width: 40 }}>——</span>
                  }
                </div>
              ))}
            </div>
          </Panel>
        </div>

      </div>
    </div>
  )
}
