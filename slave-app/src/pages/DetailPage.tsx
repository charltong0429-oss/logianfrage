import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { apiFetch } from '../api/client'
import type { NotionRecord } from '../utils/types'
import { STATUS_COLORS } from '../utils/types'
import { exportInquiryExcel } from '../utils/excel'

const LS_SEEN = 'liq_seen_v2'
function markSeen(id: string) {
  try {
    const seen: string[] = JSON.parse(localStorage.getItem(LS_SEEN) ?? '[]')
    if (!seen.includes(id)) { seen.push(id); localStorage.setItem(LS_SEEN, JSON.stringify(seen)) }
  } catch { /* ignore */ }
}

function countryFlag(code: string): string {
  if (!code || code.length !== 2) return ''
  return code.toUpperCase().split('').map(c =>
    String.fromCodePoint(c.charCodeAt(0) + 0x1F1A5)
  ).join('')
}

function fmtEur(v: number | null): string | null {
  if (v == null) return null
  return `€ ${v.toLocaleString('de-DE', { minimumFractionDigits: 2 })}`
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-2">{children}</p>
}

function Row({ label, value, mono }: { label: string; value: string | number | null | undefined; mono?: boolean }) {
  if (value == null || value === '') return null
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-gray-400 shrink-0">{label}</span>
      <span className={`text-sm text-gray-800 text-right ${mono ? 'font-mono font-medium' : ''}`}>{value}</span>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-700'}`}>
      {status}
    </span>
  )
}

// ── Dachser 报价 card ─────────────────────────────────────────────

function QuoteCard({ record }: { record: NotionRecord }) {
  const hasQuote = record.angebotnummer || record.amount != null
  if (!hasQuote) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 space-y-1.5">
        <Row label="Preisangebot Nr" value="—" />
        <Row label="金额（Netto）" value="—" />
      </div>
    )
  }
  return (
    <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3">
      <Row label="Preisangebot Nr" value={record.angebotnummer ?? '—'} mono />
      {record.amount != null && (
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-xs text-green-600 font-medium">金额（Netto）</span>
          <span className="font-mono text-lg font-bold text-green-700">
            {fmtEur(record.amount)}
          </span>
        </div>
      )}
    </div>
  )
}

// ── C state: 要求出货 inline ──────────────────────────────────────

function RequestPickupSection({ record, onRefresh }: { record: NotionRecord; onRefresh: () => void }) {
  const [open, setOpen] = useState(false)
  const [rswInput, setRswInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function close() { setOpen(false); setRswInput(''); setError('') }

  async function submit() {
    if (!rswInput.trim()) return
    setLoading(true); setError('')
    try {
      await apiFetch(`/api/records/${record.notionPageId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: '要求出货', rswCode: rswInput.trim() }),
      })
      close()
      onRefresh()
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full text-sm bg-orange-500 hover:bg-orange-600 text-white font-medium rounded-xl px-4 py-2.5 transition-colors"
      >
        要求出货
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={e => { if (e.target === e.currentTarget) close() }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">要求出货</h2>
              <button onClick={close} className="text-gray-400 hover:text-gray-600 text-xl font-light leading-none">×</button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Pickup# (RSW 码)</label>
                <input
                  type="text"
                  value={rswInput}
                  onChange={e => setRswInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') submit() }}
                  placeholder="如：RSW356-V"
                  autoFocus
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400"
                />
              </div>
              {error && <p className="text-xs text-red-500">{error}</p>}
            </div>
            <div className="px-5 pb-5 flex gap-2">
              <button onClick={close} className="flex-1 px-4 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-100 transition-colors">
                取消
              </button>
              <button
                onClick={submit}
                disabled={loading || !rswInput.trim()}
                className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white rounded-lg py-2 text-sm font-medium transition-colors"
              >
                {loading ? '提交中…' : '确认 →'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── eLOG 凭据 card (unified with M) ──────────────────────────────

function ElogCard({ record }: { record: NotionRecord }) {
  if (!record.angebotnummer && !record.rswCode) return null
  const credentials = `${record.angebotnummer ?? ''} / ${record.rswCode ?? ''}`
  return (
    <div className="space-y-2">
      <SectionLabel>eLOG 跟踪凭据</SectionLabel>
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] text-blue-500 mb-0.5">用户名 / 密码</p>
            <p className="text-base font-mono font-bold text-blue-800 break-all">
              {record.angebotnummer ?? '—'} / {record.rswCode ?? '—'}
            </p>
          </div>
          <button
            onClick={() => navigator.clipboard.writeText(credentials).catch(() => {})}
            title="复制凭据"
            className="text-blue-300 hover:text-blue-600 transition-colors text-xl leading-none shrink-0 p-1"
          >⎘</button>
        </div>
        <a
          href="https://elogistics.dachser.com"
          target="_blank"
          rel="noopener noreferrer"
          className="block text-center text-sm bg-blue-500 hover:bg-blue-600 text-white rounded-lg py-2 font-medium transition-colors"
        >
          打开 DACHSER eLOG ↗
        </a>
      </div>
    </div>
  )
}

// ── 账单信息 card with comparison ────────────────────────────────

function InvoiceCard({ record }: { record: NotionRecord }) {
  if (record.rechnungAmount == null && record.rechnungAmountBrutto == null && !record.invoiceNr) return null
  const diff = (record.amount != null && record.rechnungAmount != null)
    ? record.rechnungAmount - record.amount
    : null
  return (
    <div className="space-y-2">
      <SectionLabel>账单信息</SectionLabel>
      <div className="bg-purple-50 border border-purple-200 rounded-xl px-4 py-3 space-y-2">
        {record.invoiceNr && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">账单号</span>
            <span className="font-mono text-sm text-gray-700 font-medium">{record.invoiceNr}</span>
          </div>
        )}
        <div className="border-t border-purple-100 pt-2 space-y-1.5">
          {record.amount != null && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-green-600 font-medium">报价 Netto</span>
              <span className="font-mono text-sm font-semibold text-green-700">{fmtEur(record.amount)}</span>
            </div>
          )}
          {record.rechnungAmount != null && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-purple-600 font-medium">账单 Netto</span>
              <span className="font-mono text-sm font-semibold text-purple-700">{fmtEur(record.rechnungAmount)}</span>
            </div>
          )}
          {record.rechnungAmountBrutto != null && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-purple-400">账单 Brutto</span>
              <span className="font-mono text-sm text-purple-600">{fmtEur(record.rechnungAmountBrutto)}</span>
            </div>
          )}
          {diff != null && (
            <div className="flex items-center justify-between border-t border-purple-100 pt-1.5">
              <span className="text-xs text-gray-400">差额（Netto）</span>
              <span className={`font-mono text-sm font-bold ${diff <= 0 ? 'text-green-600' : 'text-red-500'}`}>
                {diff <= 0 ? '▼' : '▲'} {diff >= 0 ? '+' : ''}{fmtEur(diff)}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────

export default function DetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [record, setRecord] = useState<NotionRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function loadRecord() {
    setLoading(true); setError('')
    try {
      const data = await apiFetch<NotionRecord>(`/api/records/${id}`)
      setRecord(data)
      if (data.status === '已报价' && id) markSeen(id)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadRecord() }, [id])

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <p className="text-sm text-gray-400">加载中…</p>
    </div>
  )

  if (error || !record) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <p className="text-sm text-red-500">{error || '记录不存在'}</p>
    </div>
  )

  const r = record
  const isD = r.status === '要求出货' || r.status === '已要求出货' || r.status === '已要求提货'
  const isE = r.status === '已收账单'

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Nav bar */}
      <header className="bg-white border-b border-gray-200 px-4 py-2.5 flex items-center gap-3">
        <button onClick={() => navigate('/list')} className="text-gray-500 hover:text-gray-800 text-sm transition-colors">← 列表</button>
        <div className="flex-1 flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-gray-700 truncate">{r.date} · {r.country}</span>
          <StatusBadge status={r.status} />
        </div>
        <button onClick={loadRecord} className="text-xs text-gray-400 hover:text-gray-700 px-2 py-1 rounded transition-colors shrink-0">刷新</button>
      </header>

      <div className="max-w-lg mx-auto px-4 py-5 space-y-4">

        {/* ① 标题行 */}
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xl font-bold text-gray-900">
                  {countryFlag(r.country)} {r.country}
                </span>
                <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${
                  r.type === 'BATT' ? 'bg-orange-100 text-orange-700' :
                  r.type === 'ACC'  ? 'bg-purple-100 text-purple-700' :
                  'bg-blue-100 text-blue-700'
                }`}>{r.type}</span>
              </div>
              <p className="text-xs text-gray-400 mt-1">{r.date}</p>
            </div>
            {r.angebotnummer && (
              <div className="text-right shrink-0">
                <p className="text-[10px] text-gray-400 uppercase tracking-wide">Preisangebot Nr</p>
                <div className="flex items-center gap-1 justify-end mt-0.5">
                  <span className="font-mono text-sm font-semibold text-gray-800">{r.angebotnummer}</span>
                  <button
                    onClick={() => navigator.clipboard.writeText(r.angebotnummer!).catch(() => {})}
                    className="text-gray-300 hover:text-blue-500 transition-colors text-base leading-none p-1"
                  >⎘</button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ② Dachser 报价 */}
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 space-y-3">
          <SectionLabel>Dachser 报价</SectionLabel>
          <QuoteCard record={r} />
          {r.status === '已报价' && <RequestPickupSection record={r} onRefresh={loadRecord} />}
        </div>

        {/* ③ 货物信息 */}
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 space-y-3">
          <div className="flex items-center justify-between">
            <SectionLabel>货物信息</SectionLabel>
            <button
              onClick={() => exportInquiryExcel(r)}
              className="text-xs text-green-600 hover:text-green-800 font-medium flex items-center gap-1 -mt-2 transition-colors"
            >
              ↓ Inquiry Form
            </button>
          </div>
          <div className="space-y-1.5">
            <Row label="托盘数" value={r.pallets} />
            <Row label="重量" value={r.weight != null ? `${r.weight} kg` : null} />
            <Row label="体积" value={r.volume != null ? `${r.volume} CBM` : null} />
            <Row label="LDM" value={r.ldm != null ? `${r.ldm} LDM` : null} />
            {r.dimensions && <Row label="尺寸" value={r.dimensions} mono />}
            {r.remark && <Row label="备注" value={r.remark} />}
          </div>
        </div>

        {/* ④ 地址 */}
        {(r.address || r.postalCode || r.city) && (
          <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 space-y-1.5">
            <SectionLabel>收货地址</SectionLabel>
            <div className="text-sm text-gray-700 space-y-0.5">
              {r.address && <div>{r.address}</div>}
              {(r.postalCode || r.city) && (
                <div>{[r.postalCode, r.city].filter(Boolean).join(' ')}</div>
              )}
              <div>{countryFlag(r.country)} {r.country}</div>
            </div>
          </div>
        )}

        {/* ⑤ eLOG 凭据 (D/E) */}
        {(isD || isE) && (
          <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
            <ElogCard record={r} />
          </div>
        )}

        {/* ⑥ 账单信息 (E) */}
        {isE && (
          <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
            <InvoiceCard record={r} />
          </div>
        )}

      </div>
    </div>
  )
}
