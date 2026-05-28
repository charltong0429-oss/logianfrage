import { useState, useRef, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import * as XLSX from 'xlsx'
import type { CargoType } from '../utils/types'
import { COUNTRIES } from '../utils/types'

// ── 尺寸格式：1.23*1.23*1.23 m ────────────────────────────────────────────────
const DIM_RE = /^(\d+[.,]?\d*)\s*\*\s*(\d+[.,]?\d*)\s*\*\s*(\d+[.,]?\d*)\s*m?$/i

function isDimValid(s: string): boolean {
  return s.trim() === '' || DIM_RE.test(s.trim())
}

function normalizeDim(s: string): string {
  const m = s.trim().match(/(\d+[.,]?\d*)\s*\*\s*(\d+[.,]?\d*)\s*\*\s*(\d+[.,]?\d*)/)
  if (!m) return s.trim()
  const n = (v: string) => String(parseFloat(v.replace(',', '.')))
  return `${n(m[1])}*${n(m[2])}*${n(m[3])} m`
}

function calcVolume(dims: string[]): number {
  let total = 0
  for (const d of dims) {
    const m = d.trim().match(/(\d+\.?\d*)\s*\*\s*(\d+\.?\d*)\s*\*\s*(\d+\.?\d*)/)
    if (m) total += parseFloat(m[1]) * parseFloat(m[2]) * parseFloat(m[3])
  }
  return Math.round(total * 1000) / 1000
}

// ── Excel 解析 ────────────────────────────────────────────────────────────────
function extractAllDimensions(d14: string): string[] {
  const pattern = /(\d+[.,]?\d*)\s*[*×xX]\s*(\d+[.,]?\d*)\s*[*×xX]\s*(\d+[.,]?\d*)/g
  const dims: string[] = []
  let m: RegExpExecArray | null
  while ((m = pattern.exec(d14)) !== null) {
    const n = (s: string) => String(parseFloat(s.replace(',', '.')))
    dims.push(`${n(m[1])}*${n(m[2])}*${n(m[3])} m`)
  }
  return dims
}

async function parseExcelFile(file: File) {
  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(buffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const get = (ref: string): string => {
    const cell = ws[ref]; if (!cell) return ''; return String(cell.v ?? '').trim()
  }

  const d13 = get('D13'), d14 = get('D14'), d16 = get('D16'), d17 = get('D17')
  const d22 = get('D22'), d23 = get('D23'), d24 = get('D24')

  let type: CargoType = 'INV'
  const up = d13.toUpperCase()
  if (up.includes('BATT')) type = 'BATT'
  else if (up.includes('ACC')) type = 'ACC'

  const palletsM = d13.match(/(\d+)/)
  const weightM  = d17.replace(/\./g, '').replace(',', '.').match(/([\d.]+)/)
  const ldmM     = d16.replace(/,/g, '.').match(/([\d.]+)/)
  const dims     = extractAllDimensions(d14)

  return {
    type,
    pallets:    palletsM ? palletsM[1] : '1',
    weight:     weightM  ? weightM[1]  : '',
    ldm:        ldmM     ? ldmM[1]     : '',
    dimensions: dims,
    rawAddress: [d22, d23, d24].filter(Boolean).join(', '),
  }
}

// ── 主组件 ────────────────────────────────────────────────────────────────────
export default function NewInquiryPage() {
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [submitting, setSubmitting]   = useState(false)
  const [error, setError]             = useState('')

  const [type, setType]               = useState<CargoType>('INV')
  const [country, setCountry]         = useState('DE')

  // 地址
  const [rawAddress, setRawAddress]   = useState('')
  const [street, setStreet]           = useState('')
  const [postalCode, setPostalCode]   = useState('')
  const [city, setCity]               = useState('')
  const [stateProvince, setStateProv] = useState('')
  const [normalizing, setNormalizing] = useState(false)
  const [addrError, setAddrError]     = useState('')

  // 货物
  const [pallets, setPallets]         = useState('1')
  const [weight, setWeight]           = useState('')
  const [dimensions, setDimensions]   = useState<string[]>([''])
  const [dimErrors, setDimErrors]     = useState<boolean[]>([false])
  const [ldm, setLdm]                 = useState('')
  const [remark, setRemark]           = useState('')

  const [isDragging, setIsDragging]   = useState(false)
  const [excelFile, setExcelFile]     = useState('')
  const [excelError, setExcelError]   = useState('')

  // ── 托盘数变化时同步尺寸数组 ─────────────────────────────────────────────
  function handlePalletsChange(val: string) {
    setPallets(val)
    const n = Math.max(1, parseInt(val) || 1)
    setDimensions(prev => {
      if (n > prev.length) return [...prev, ...Array(n - prev.length).fill('')]
      return prev.slice(0, n)
    })
    setDimErrors(prev => {
      if (n > prev.length) return [...prev, ...Array(n - prev.length).fill(false)]
      return prev.slice(0, n)
    })
  }

  function handleDimChange(idx: number, val: string) {
    setDimensions(prev => prev.map((d, i) => i === idx ? val : d))
    setDimErrors(prev => prev.map((e, i) => i === idx ? false : e))
  }

  function handleDimBlur(idx: number) {
    const val = dimensions[idx]
    if (val.trim() && !isDimValid(val)) {
      setDimErrors(prev => prev.map((e, i) => i === idx ? true : e))
    }
  }

  // ── AI 地址解析（IPC → Openrouter） ─────────────────────────────────────
  async function normalizeAddress(raw: string) {
    if (!raw.trim()) return
    setNormalizing(true); setAddrError('')
    try {
      const res = await window.api.normalizeAddress(raw)
      if (!res.ok || !res.data) {
        setAddrError(res.error ?? '解析失败，请手动填写下方各字段')
        return
      }
      const norm = res.data
      if (norm.street)     setStreet(norm.street)
      if (norm.postalCode) setPostalCode(norm.postalCode)
      if (norm.city)       setCity(norm.city)
      if (norm.country) {
        const matched = COUNTRIES.find(c => c.code === norm.country.toUpperCase())
        if (matched) setCountry(matched.code)
      }
    } catch {
      setAddrError('解析失败，请手动填写下方各字段')
    } finally {
      setNormalizing(false)
    }
  }

  // ── Excel 导入 ────────────────────────────────────────────────────────────
  async function applyExcel(file: File) {
    if (!file.name.match(/\.(xlsx|xls)$/i)) { setExcelError('请选择 .xlsx 或 .xls 文件'); return }
    setExcelError(''); setAddrError('')
    try {
      const p = await parseExcelFile(file)
      setType(p.type)
      handlePalletsChange(p.pallets)
      if (p.weight) setWeight(p.weight)
      if (p.ldm)    setLdm(p.ldm)
      if (p.dimensions.length > 0) {
        const n = parseInt(p.pallets) || 1
        const filled = p.dimensions.length >= n
          ? p.dimensions.slice(0, n)
          : [...p.dimensions, ...Array(n - p.dimensions.length).fill('')]
        setDimensions(filled)
        setDimErrors(Array(filled.length).fill(false))
      }
      setExcelFile(file.name)
      if (p.rawAddress) {
        setRawAddress(p.rawAddress)
        await normalizeAddress(p.rawAddress)
      }
    } catch (e) { setExcelError(`解析失败：${String(e)}`) }
  }

  // ── 提交 ─────────────────────────────────────────────────────────────────
  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const newErrors = dimensions.map(d => d.trim() !== '' && !isDimValid(d))
    if (newErrors.some(Boolean)) { setDimErrors(newErrors); return }
    if (!postalCode.trim()) { setError('邮编不能为空'); return }
    if (!city.trim())       { setError('城市不能为空'); return }

    setError(''); setSubmitting(true)
    try {
      const today = new Date()
      const date = `${today.getFullYear()}.${String(today.getMonth()+1).padStart(2,'0')}.${String(today.getDate()).padStart(2,'0')}`

      const validDims = dimensions.filter(d => d.trim()).map(normalizeDim)
      const volume    = validDims.length > 0 ? calcVolume(validDims) : null
      const dimsStr   = validDims.join(', ') || null
      const cityFull  = stateProvince.trim() ? `${city.trim()}, ${stateProvince.trim()}` : city.trim()

      const res = await window.api.createRecord({
        date, type, country,
        pallets:    pallets ? Number(pallets) : null,
        weight:     weight  ? Number(weight)  : null,
        volume:     volume  || null,
        dimensions: dimsStr,
        ldm:        ldm     ? Number(ldm)     : null,
        address:    street     || null,
        postalCode: postalCode || null,
        city:       cityFull   || null,
        remark:     remark     || null,
      })
      if (!res.ok || !res.pageId) throw new Error(res.error ?? '创建失败')
      navigate(`/detail/${res.pageId}`, { replace: true })
    } catch (e) { setError(String(e)); setSubmitting(false) }
  }

  const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400'

  const volume = (() => {
    const v = calcVolume(dimensions)
    return v > 0 ? v : null
  })()

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4">
        <button onClick={() => navigate(-1)} className="text-gray-500 hover:text-gray-800 text-sm transition-colors">← 返回</button>
        <h1 className="text-lg font-semibold text-gray-800">新建询价</h1>
      </header>

      <div className="max-w-2xl mx-auto px-6 py-6 space-y-4">

        {/* Excel 拖入区 */}
        <div
          onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={e => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f) applyExcel(f) }}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl px-6 py-5 text-center cursor-pointer transition-colors select-none ${
            isDragging    ? 'border-blue-400 bg-blue-50' :
            normalizing   ? 'border-yellow-300 bg-yellow-50' :
            excelFile     ? 'border-green-400 bg-green-50' :
                            'border-gray-300 bg-white hover:border-blue-300 hover:bg-gray-50'
          }`}
        >
          {normalizing
            ? <p className="text-sm text-yellow-700">正在解析地址…</p>
            : excelFile
            ? <p className="text-sm text-green-700 font-medium">✓ 已读取：{excelFile}</p>
            : <>
                <p className="text-sm text-gray-500">{isDragging ? '松开鼠标导入' : '拖入 Shipment Inquiry Form (.xlsx) 自动填表'}</p>
                <p className="text-xs text-gray-400 mt-1">或点击此处选择文件</p>
              </>
          }
          {excelError && <p className="text-xs text-red-500 mt-1">{excelError}</p>}
        </div>
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) applyExcel(f); e.target.value = '' }} />

        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">

          {/* 货物类型 + 目的国 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">货物类型 *</label>
              <select value={type} onChange={e => setType(e.target.value as CargoType)} className={inputCls}>
                <option value="INV">INV</option>
                <option value="BATT">BATT</option>
                <option value="ACC">ACC</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">目的国 *</label>
              <select value={country} onChange={e => setCountry(e.target.value)} className={inputCls}>
                {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select>
            </div>
          </div>

          {/* 收件地址区 */}
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-gray-600">收件地址（粘贴完整地址，AI 解析）</label>
                <button
                  type="button"
                  onClick={() => normalizeAddress(rawAddress)}
                  disabled={normalizing || !rawAddress.trim()}
                  className="text-xs text-blue-600 hover:text-blue-800 disabled:text-gray-300 transition-colors"
                >
                  {normalizing ? '解析中…' : '解析地址'}
                </button>
              </div>
              <textarea
                value={rawAddress}
                onChange={e => setRawAddress(e.target.value)}
                rows={3}
                placeholder="粘贴完整收件地址，如：&#10;Musterstraße 12&#10;80331 München&#10;Germany"
                className={`${inputCls} resize-none font-mono text-xs`}
              />
              {addrError && <p className="text-xs text-amber-600 mt-1">{addrError}</p>}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">街道地址（可选）</label>
              <input type="text" value={street} onChange={e => setStreet(e.target.value)}
                placeholder="如：Musterstraße 12" className={inputCls} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">邮编 *</label>
                <input type="text" value={postalCode} onChange={e => setPostalCode(e.target.value)}
                  required placeholder="如：80331" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">城市 *</label>
                <input type="text" value={city} onChange={e => setCity(e.target.value)}
                  required placeholder="如：München" className={inputCls} />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">省 / 州（可选）</label>
              <input type="text" value={stateProvince} onChange={e => setStateProv(e.target.value)}
                placeholder="如：Bayern" className={inputCls} />
            </div>
          </div>

          {/* 托盘数 + 重量 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">托盘数 *</label>
              <input type="number" min="1" value={pallets}
                onChange={e => handlePalletsChange(e.target.value)}
                required placeholder="整数" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">重量 (kg) *</label>
              <input type="number" min="0" step="0.01" value={weight} onChange={e => setWeight(e.target.value)}
                required placeholder="如：1200" className={inputCls} />
            </div>
          </div>

          {/* 每托盘尺寸 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-600">
                货物尺寸 (m) *
                <span className="ml-1 text-gray-400 font-normal">格式：1.23*1.23*1.23 m</span>
              </label>
              {volume != null && (
                <span className="text-xs text-green-600">体积共 {volume} m³</span>
              )}
            </div>
            <div className="space-y-2">
              {dimensions.map((d, i) => (
                <div key={i} className="flex items-center gap-2">
                  {dimensions.length > 1 && (
                    <span className="text-xs text-gray-400 w-10 shrink-0 text-right">托 {i + 1}</span>
                  )}
                  <div className="flex-1">
                    <input
                      type="text"
                      value={d}
                      onChange={e => handleDimChange(i, e.target.value)}
                      onBlur={() => handleDimBlur(i)}
                      placeholder="如：0.81*1.08*0.94 m"
                      className={`${inputCls} font-mono ${dimErrors[i] ? 'border-red-400 ring-1 ring-red-400' : ''}`}
                    />
                    {dimErrors[i] && (
                      <p className="text-xs text-red-500 mt-0.5">格式错误，请输入 L*W*H m（如：0.81*1.08*0.94 m）</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* LDM */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">LDM（可选）</label>
            <input type="number" min="0" step="0.01" value={ldm} onChange={e => setLdm(e.target.value)}
              placeholder="如：3.5" className={inputCls} />
          </div>

          {/* 备注 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">备注（可选）</label>
            <textarea value={remark} onChange={e => setRemark(e.target.value)}
              rows={3} className={`${inputCls} resize-none`} />
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => navigate(-1)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors">取消</button>
            <button type="submit" disabled={submitting || normalizing}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors">
              {submitting ? '提交中…' : normalizing ? '地址解析中…' : '提交询价'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
