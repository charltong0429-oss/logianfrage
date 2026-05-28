import React, { useState } from 'react'

interface Props {
  subject: string
  body: string
}

export default function EmailPreview({ subject, body }: Props) {
  const [copiedSubject, setCopiedSubject] = useState(false)
  const [copiedBody, setCopiedBody] = useState(false)

  async function copySubject() {
    await window.api.copyToClipboard(subject)
    setCopiedSubject(true)
    setTimeout(() => setCopiedSubject(false), 1500)
  }

  async function copyBody() {
    await window.api.copyToClipboard(body)
    setCopiedBody(true)
    setTimeout(() => setCopiedBody(false), 1500)
  }

  return (
    <div className="flex flex-col h-full">
      {/* 主题 */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-gray-400 font-medium uppercase tracking-wide">主题</span>
          <button
            onClick={copySubject}
            className="text-xs bg-gray-100 hover:bg-gray-200 border border-gray-200 text-gray-600 rounded px-2 py-0.5 transition-colors"
          >
            {copiedSubject ? '已复制 ✓' : '复制主题'}
          </button>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded px-3 py-2 text-sm text-gray-800 break-all min-h-[2.5rem]">
          {subject || <span className="text-gray-300 italic">（填写表单后自动生成）</span>}
        </div>
      </div>

      {/* 正文 */}
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-gray-400 font-medium uppercase tracking-wide">正文</span>
          <button
            onClick={copyBody}
            className="text-xs bg-gray-100 hover:bg-gray-200 border border-gray-200 text-gray-600 rounded px-2 py-0.5 transition-colors"
          >
            {copiedBody ? '已复制 ✓' : '复制正文'}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto bg-gray-50 border border-gray-200 rounded px-3 py-2 text-sm text-gray-800 whitespace-pre-wrap font-mono leading-relaxed">
          {body || <span className="text-gray-300 italic">（填写表单后自动生成）</span>}
        </div>
      </div>
    </div>
  )
}
