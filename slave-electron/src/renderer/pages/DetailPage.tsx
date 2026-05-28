import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { NotionRecord } from '../utils/types'
import { STATUS_COLORS } from '../utils/types'
import { exportInquiryExcel } from '../utils/excel'

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value == null || value === '') return null
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-800 mt-0.5">{value}</dd>
    </div>
  )
}

function ActionPanel({ record, onRefresh }: { record: NotionRecord; onRefresh: () => void }) {
  const [loading, setLoading] = useState(false)
  const [rswInput, setRswInput] = useState('')
  const [error, setError] = useState('')

  async function patch(params: { status?: string; rswCode?: string }) {
    setLoading(true); setError('')
    try {
      const res = await window.api.updateRecord(record.notionPageId, params as Parameters<typeof window.api.updateRecord>[1])
      if (!res.ok) throw new Error(res.error)
      onRefresh()
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }

  if (record.status === '已报价') {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-3">
        <div>
          <label className="text-xs text-gray-500 block mb-1">Pickup#</label>
          <input type="text" value={rswInput} onChange={e => setRswInput(e.target.value)}
            placeholder="请输入 Pickup 编号"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-400" />
        </div>
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <button onClick={() => patch({ status: '已确认', rswCode: rswInput })}
          disabled={loading || !rswInput.trim()}
          className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg py-2 text-sm font-medium transition-colors">
          {loading ? '提交中…' : '要求提货 →'}
        </button>
      </div>
    )
  }

  if (record.status === '已确认') {
    if (record.rswCode) {
      return (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-xs text-gray-500 mb-1">Pickup# / RSW 码</p>
          <p className="text-sm font-mono font-semibold text-blue-800">{record.rswCode}</p>
        </div>
      )
    }
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <p className="text-sm text-gray-500">等待 MasterApp 确认并发送提货通知</p>
      </div>
    )
  }

  const descriptions: Partial<Record<string, string>> = {
    '待询价':    '询价已创建，等待发送询价邮件。',
    '已询价':    '询价邮件已发送，等待承运商报价。',
    '已填表':    'Speditionsauftrag 已填写，等待提货。',
    '已要求提货':'已发送提货请求，等待 DACHSER 确认。',
    '已提货':    `货物已提货。${record.trackingNr ? ` Tracking Nr: ${record.trackingNr}` : ''}`,
    '已收账单':  '账单已收到。',
  }
  const desc = descriptions[record.status]
  if (desc) {
    return <div className="bg-gray-50 border border-gray-200 rounded-lg p-4"><p className="text-sm text-gray-600">{desc}</p></div>
  }
  return null
}

export default function DetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [record, setRecord] = useState<NotionRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function loadRecord() {
    if (!id) return
    setLoading(true); setError('')
    const res = await window.api.getRecord(id)
    if (!res.ok || !res.record) { setError(res.error ?? '记录不存在'); setLoading(false); return }
    setRecord(res.record); setLoading(false)
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

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4">
        <button onClick={() => navigate('/list')} className="text-gray-500 hover:text-gray-800 text-sm transition-colors">← 列表</button>
        <div className="flex items-center gap-2 flex-1">
          <span className="text-sm font-semibold text-gray-700">{record.date} · {record.type} · {record.country}</span>
          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[record.status]}`}>{record.status}</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadRecord} className="text-xs text-gray-500 hover:text-gray-800 px-3 py-1.5 rounded hover:bg-gray-100 transition-colors">刷新</button>
          <button onClick={() => exportInquiryExcel(record)} className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded transition-colors">导出 Excel</button>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-6 py-6 space-y-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">货物信息</h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
            <Field label="货物类型" value={record.type} />
            <Field label="目的国"   value={record.country} />
            <Field label="邮编"     value={record.postalCode} />
            <Field label="城市"     value={record.city} />
            {record.address && (
              <div className="col-span-2">
                <dt className="text-xs text-gray-500">街道地址</dt>
                <dd className="text-sm text-gray-800 mt-0.5">{record.address}</dd>
              </div>
            )}
            <Field label="托盘数" value={record.pallets} />
            <Field label="重量"   value={record.weight != null ? `${record.weight} kg` : null} />
            <Field label="体积"   value={record.volume != null ? `${record.volume} CBM` : null} />
            <Field label="LDM"    value={record.ldm    != null ? `${record.ldm} LDM`   : null} />
            {record.remark && (
              <div className="col-span-2">
                <dt className="text-xs text-gray-500">备注</dt>
                <dd className="text-sm text-gray-800 mt-0.5">{record.remark}</dd>
              </div>
            )}
          </dl>
        </div>

        {record.amount != null && (
          <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-xl px-5 py-4">
            <div>
              <p className="text-[10px] font-semibold text-green-600 uppercase tracking-wide mb-0.5">DACHSER 报价</p>
              {record.angebotnummer && (
                <p className="text-xs text-gray-400 font-mono">Nr. {record.angebotnummer}</p>
              )}
            </div>
            <div className="text-right">
              <p className="text-[10px] text-green-600 mb-0.5">Netto</p>
              <span className="text-3xl font-bold text-green-700 tabular-nums">
                € {record.amount.toLocaleString('de-DE', { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        )}

        {(record.rechnungAmount != null || record.rechnungAmountBrutto != null) && (
          <div className="flex items-center justify-between bg-purple-50 border border-purple-200 rounded-xl px-5 py-4">
            <p className="text-[10px] font-semibold text-purple-600 uppercase tracking-wide">DACHSER 账单</p>
            <div className="flex items-end gap-5">
              {record.rechnungAmount != null && (
                <div className="text-right">
                  <p className="text-[10px] text-purple-500 mb-0.5">Netto</p>
                  <span className="text-3xl font-bold text-purple-700 tabular-nums">
                    € {record.rechnungAmount.toLocaleString('de-DE', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              )}
              {record.rechnungAmountBrutto != null && (
                <div className="text-right">
                  <p className="text-[10px] text-purple-400 mb-0.5">Brutto</p>
                  <span className="text-xl font-semibold text-purple-600 tabular-nums">
                    € {record.rechnungAmountBrutto.toLocaleString('de-DE', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {!record.amount && record.angebotnummer && (
          <div className="bg-white rounded-xl border border-gray-200 px-5 py-3">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Preisangebot</p>
            <p className="text-sm font-mono text-gray-700">{record.angebotnummer}</p>
          </div>
        )}

        <ActionPanel record={record} onRefresh={loadRecord} />
      </div>
    </div>
  )
}
