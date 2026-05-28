import React, { useState } from 'react'
import { FormData, CargoType } from '../utils/types'
import { MailClient } from '../App'

interface Props {
  data: FormData
  onChange: (patch: Partial<FormData>) => void
  onReset: () => void
  subject: string
  body: string
  mailClient: MailClient
  mailApp: string
  webmailUrl: string
  basePath: string
}

export default function InquiryForm({
  data,
  onChange,
  onReset,
  subject,
  body,
  mailClient,
  mailApp,
  webmailUrl,
  basePath,
}: Props) {
  const [notification, setNotification] = useState<{ msg: string; isError: boolean; isWarn: boolean } | null>(null)

  function showNotice(msg: string, ms = 3000, isError = false, isWarn = false) {
    setNotification({ msg, isError, isWarn })
    setTimeout(() => setNotification(null), ms)
  }

  async function handleImportExcel() {
    const parsed = await window.api.openAndParseExcel()
    if (!parsed) return
    onChange(parsed)
  }

  async function handleSendMail() {
    const mailtoUrl =
      'mailto:' +
      encodeURIComponent(data.recipient) +
      '?subject=' + encodeURIComponent(subject)

    if (mailClient === 'system') {
      await window.api.copyToClipboard(body)

      if (mailApp.trim()) {
        const result = await window.api.openWithMailApp(mailApp.trim(), mailtoUrl)
        if (result.ok) {
          showNotice(`${mailApp} 已打开（收件人+主题已填入）。正文已复制到剪贴板，请 Cmd+V 粘贴到邮件正文。`, 5000)
        } else {
          showNotice(`错误：${result.message ?? '未知错误'}`, 6000, true)
          return
        }
      } else {
        await window.api.openUrl(mailtoUrl)
        showNotice('邮件客户端已打开（收件人+主题已填入）。正文已复制到剪贴板，请 Cmd+V 粘贴。', 5000)
      }
    } else {
      const fullContent = `主题：${subject}\n\n${body}`
      await window.api.copyToClipboard(fullContent)
      if (webmailUrl) {
        await window.api.openUrl(webmailUrl)
      }
      showNotice('主题和正文已复制到剪贴板，请在网页邮件中粘贴。')
    }

    // 创建档案文件夹
    if (basePath && data.address3) {
      const today = new Date()
      const date = [
        today.getFullYear(),
        String(today.getMonth() + 1).padStart(2, '0'),
        String(today.getDate()).padStart(2, '0'),
      ].join('.')

      const folderResult = await window.api.createArchiveFolder({
        basePath,
        date,
        type: data.cargoType,
        country: data.address3,
      })

      if (folderResult.ok && folderResult.folderName) {
        // 触发 Notion 同步
        const notionResult = await window.api.notionCreatePage({
          folderPath: folderResult.folderPath!,
          date,
          type: data.cargoType,
          country: data.address3,
          pallets: data.pallets,
          weight: data.weight,
          loadingMeters: data.loadingMeters,
        })
        if (!notionResult.ok) {
          showNotice(`档案文件夹已创建：${folderResult.folderName}。Notion 同步失败：${notionResult.error ?? '请检查设置'}`, 6000, false, true)
        } else {
          showNotice(`档案文件夹已创建：${folderResult.folderName}`, 4000)
        }
      } else if (!folderResult.ok) {
        showNotice(`档案文件夹创建失败：${folderResult.error ?? '未知错误'}`, 5000, true)
      }
    }
  }

  const field = (label: string, key: keyof FormData, placeholder?: string) => (
    <div className="flex items-center gap-2 mb-3">
      <label className="w-24 text-sm text-gray-600 shrink-0 text-right">{label}</label>
      <input
        type="text"
        value={data[key] as string}
        placeholder={placeholder}
        onChange={(e) => onChange({ [key]: e.target.value })}
        className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
      />
    </div>
  )

  return (
    <div className="flex flex-col h-full">
      {/* 导入按钮 */}
      <button
        onClick={handleImportExcel}
        className="mb-4 bg-blue-50 hover:bg-blue-100 border border-blue-300 text-blue-700 text-sm rounded px-3 py-1.5 transition-colors"
      >
        导入 Excel
      </button>

      {/* 货物信息 */}
      <p className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wide">货物信息</p>
      {field('托盘数', 'pallets', '例：2 pallets')}
      {field('尺寸', 'dimensions', '例：120x80x100 cm')}
      {field('装载米数', 'loadingMeters', '例：0.8 ldm')}
      {field('重量', 'weight', '例：500 kg')}

      {/* 收货地址 */}
      <p className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wide">收货地址</p>
      {field('街道地址', 'address1', '街道地址')}
      {field('邮编/城市', 'address2', '例：81000 Albi')}
      {field('国家', 'address3', '例：France')}

      {/* 货物类型 */}
      <div className="flex items-center gap-4 mb-3">
        <span className="w-24 text-sm text-gray-600 text-right shrink-0">货物类型</span>
        {(['INV', 'BATT', 'ACC'] as CargoType[]).map((t) => (
          <label key={t} className="flex items-center gap-1 cursor-pointer text-sm">
            <input
              type="radio"
              name="cargoType"
              checked={data.cargoType === t}
              onChange={() => onChange({ cargoType: t })}
            />
            {t}
          </label>
        ))}
      </div>

      {/* 保价 */}
      <div className="flex items-center gap-4 mb-1">
        <span className="w-24 text-sm text-gray-600 text-right shrink-0">保价</span>
        <label className="flex items-center gap-1 cursor-pointer text-sm">
          <input type="radio" name="hasInsurance" checked={data.hasInsurance === true} onChange={() => onChange({ hasInsurance: true })} />
          是
        </label>
        <label className="flex items-center gap-1 cursor-pointer text-sm">
          <input type="radio" name="hasInsurance" checked={data.hasInsurance === false} onChange={() => onChange({ hasInsurance: false })} />
          否
        </label>
      </div>

      {data.hasInsurance && (
        <div className="flex items-center gap-2 mb-3">
          <label className="w-24 text-sm text-gray-600 shrink-0 text-right">金额 (€)</label>
          <input
            type="number"
            value={data.insuranceAmount}
            placeholder="保价金额"
            onChange={(e) => onChange({ insuranceAmount: e.target.value })}
            className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>
      )}

      {/* 通知提示 */}
      {notification && (
        <div className={`mb-2 px-3 py-2 rounded text-xs border ${
          notification.isError
            ? 'bg-red-50 border-red-200 text-red-700'
            : notification.isWarn
            ? 'bg-yellow-50 border-yellow-200 text-yellow-700'
            : 'bg-green-50 border-green-200 text-green-700'
        }`}>
          {notification.msg}
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex gap-3 mt-auto pt-4">
        <button
          onClick={onReset}
          className="flex-1 bg-gray-100 hover:bg-gray-200 border border-gray-300 text-gray-700 text-sm rounded px-3 py-2 transition-colors"
        >
          重置
        </button>
        <button
          onClick={handleSendMail}
          className="flex-1 bg-green-600 hover:bg-green-700 text-white text-sm rounded px-3 py-2 transition-colors"
        >
          {mailClient === 'webmail' ? '打开网页邮件' : '发送邮件'}
        </button>
      </div>
    </div>
  )
}
