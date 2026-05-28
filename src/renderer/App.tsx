import React, { useState, useEffect } from 'react'
import FileImportTab from './components/FileImportTab'
import RecordsTab from './components/RecordsTab'
import NotionSettingsTab from './components/NotionSettingsTab'
import PilotView from './components/PilotView'
import { AppConfig, DEFAULT_BASE_PATH, EmailConfig } from './utils/types'

export type MailClient = 'system' | 'webmail' | 'smtp'
type Tab = 'overview' | 'records' | 'settings'

const SK_CLIENT = 'liq_mail_client'
const SK_MAIL_APP = 'liq_mail_app'
const SK_WEBMAIL_URL = 'liq_webmail_url'

function loadSetting<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v !== null ? (JSON.parse(v) as T) : fallback
  } catch { return fallback }
}
function saveSetting(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value))
}

const DEFAULT_EMAIL_DRAFT: EmailConfig = {
  smtpHost: 'smtp.qiye.aliyun.com', smtpPort: 465, smtpSsl: true,
  imapHost: 'imap.qiye.aliyun.com', imapPort: 993, imapSsl: true,
  username: '', password: '',
}

const NAV_ITEMS: { id: Tab; label: string; icon: string }[] = [
  { id: 'overview', label: '纵览',    icon: '◎' },
  { id: 'records',  label: '询价管理', icon: '≡' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('records')
  const [appConfig, setAppConfig] = useState<AppConfig>({ notion: null, basePath: DEFAULT_BASE_PATH, email: null })
  const [mailClient, setMailClient] = useState<MailClient>(() => loadSetting<MailClient>(SK_CLIENT, 'smtp'))
  const [mailApp,    setMailApp]    = useState<string>(() => loadSetting(SK_MAIL_APP, ''))
  const [webmailUrl, setWebmailUrl] = useState<string>(() => loadSetting(SK_WEBMAIL_URL, ''))

  const [emailDraft, setEmailDraft] = useState<EmailConfig>(DEFAULT_EMAIL_DRAFT)
  const [smtpTestStatus, setSmtpTestStatus] = useState<{ ok: boolean; msg: string } | null>(null)
  const [imapTestStatus, setImapTestStatus] = useState<{ ok: boolean; msg: string } | null>(null)
  const [emailSaving, setEmailSaving] = useState(false)
  const [testSending, setTestSending] = useState(false)
  const [testSendStatus, setTestSendStatus] = useState<{ ok: boolean; msg: string } | null>(null)

  useEffect(() => {
    window.api.readAppConfig().then(cfg => {
      setAppConfig(cfg)
      if (cfg.email) setEmailDraft(cfg.email)
    }).catch(() => {})
  }, [])

  function handleConfigSave(config: AppConfig) { setAppConfig(config) }

  async function handleEmailTestSmtp() {
    setSmtpTestStatus(null)
    const res = await window.api.emailTestSmtp(emailDraft)
    setSmtpTestStatus(res.ok ? { ok: true, msg: 'SMTP 连接成功！' } : { ok: false, msg: `SMTP 失败：${res.error}` })
  }
  async function handleEmailTestImap() {
    setImapTestStatus(null)
    const res = await window.api.emailTestImap(emailDraft)
    setImapTestStatus(res.ok ? { ok: true, msg: 'IMAP 连接成功！' } : { ok: false, msg: `IMAP 失败：${res.error}` })
  }
  async function handleTestSendEmail() {
    if (!emailDraft.username) return
    setTestSending(true); setTestSendStatus(null)
    const res = await window.api.emailSend(emailDraft, {
      to: emailDraft.username, subject: '[LogiAnfrage] 测试邮件',
      body: '这是一封来自 LogiAnfrage 的测试邮件，说明 SMTP 发送功能工作正常。',
    })
    setTestSending(false)
    setTestSendStatus(res.ok
      ? { ok: true,  msg: `测试邮件已发送至 ${emailDraft.username}` }
      : { ok: false, msg: `发送失败：${res.error}` })
  }
  async function handleEmailSave() {
    setEmailSaving(true)
    const newConfig: AppConfig = { ...appConfig, email: emailDraft }
    await window.api.saveAppConfig(newConfig)
    setAppConfig(newConfig)
    setEmailSaving(false)
  }

  const navBtn = (item: typeof NAV_ITEMS[0]) => (
    <button
      key={item.id}
      onClick={() => setTab(item.id)}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
        tab === item.id
          ? 'bg-blue-600 text-white'
          : 'text-gray-400 hover:bg-gray-800 hover:text-white'
      }`}
    >
      <span className="text-base leading-none">{item.icon}</span>
      <span>{item.label}</span>
    </button>
  )

  const inputCls = 'border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400'
  const statusBanner = (s: { ok: boolean; msg: string } | null) => s && (
    <div className={`text-xs px-3 py-1.5 rounded border ${s.ok ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
      {s.msg}
    </div>
  )

  return (
    <div className="flex h-screen bg-white overflow-hidden">

      {/* ── SideBar ── */}
      <div className="w-44 shrink-0 bg-gray-900 flex flex-col select-none">
        {/* Logo */}
        <div className="px-4 py-5 border-b border-gray-700/60">
          <div className="text-white font-bold text-sm tracking-tight">LogiAnfrage</div>
          <div className="text-gray-500 text-[11px] mt-0.5">物流询价管理</div>
        </div>

        {/* Main nav */}
        <nav className="flex-1 py-3 px-2 space-y-0.5">
          {NAV_ITEMS.map(navBtn)}
        </nav>

        {/* Settings at bottom */}
        <div className="px-2 py-3 border-t border-gray-700/60">
          <button
            onClick={() => setTab('settings')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              tab === 'settings'
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:bg-gray-800 hover:text-white'
            }`}
          >
            <span className="text-base leading-none">⚙</span>
            <span>设置</span>
          </button>
        </div>
      </div>

      {/* ── Main ── */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0">

        {/* 纵览 */}
        {tab === 'overview' && (
          <div className="flex-1 min-h-0">
            <PilotView />
          </div>
        )}

        {/* 询价管理 = 文件导入（顶部折叠）+ 询价列表 */}
        {tab === 'records' && (
          <div className="flex-1 min-h-0 flex flex-col">
            {/* 文件导入区 — 固定高度，可滚动 */}
            <div className="shrink-0 max-h-56 overflow-y-auto border-b border-gray-200 bg-gray-50">
              <FileImportTab />
            </div>
            {/* 询价列表 */}
            <div className="flex-1 min-h-0">
              <RecordsTab
                basePath={appConfig.basePath}
                mailClient={mailClient}
                mailApp={mailApp}
                webmailUrl={webmailUrl}
                defaultRecipient={appConfig.email?.defaultRecipient}
              />
            </div>
          </div>
        )}

        {/* 设置 */}
        {tab === 'settings' && (
          <div className="flex-1 overflow-y-auto">
            <NotionSettingsTab config={appConfig} onSave={handleConfigSave} />

            {/* ── 邮件账户 ── */}
            <div className="px-6 py-5 border-t border-gray-200 max-w-xl">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">邮件账户</p>

              <p className="text-sm font-semibold text-gray-700 mb-3">发件（SMTP）</p>
              <div className="space-y-2 mb-4">
                <div className="flex items-center gap-2">
                  <label className="w-20 text-sm text-gray-600 text-right shrink-0">服务器</label>
                  <input type="text" value={emailDraft.smtpHost} onChange={e => setEmailDraft(d => ({ ...d, smtpHost: e.target.value }))} placeholder="smtp.qiye.aliyun.com" className={`flex-1 ${inputCls}`} />
                </div>
                <div className="flex items-center gap-2">
                  <label className="w-20 text-sm text-gray-600 text-right shrink-0">端口</label>
                  <select value={emailDraft.smtpPort} onChange={e => { const p = Number(e.target.value) as 25|465; setEmailDraft(d => ({ ...d, smtpPort: p, smtpSsl: p === 465 })) }} className={`w-24 ${inputCls} bg-white`}>
                    <option value={465}>465 (SSL)</option>
                    <option value={25}>25 (非加密)</option>
                  </select>
                  <label className="flex items-center gap-1 text-sm text-gray-600 cursor-pointer">
                    <input type="checkbox" checked={emailDraft.smtpSsl} onChange={e => setEmailDraft(d => ({ ...d, smtpSsl: e.target.checked }))} className="rounded" /> SSL
                  </label>
                </div>
                {statusBanner(smtpTestStatus)}
                <div className="flex justify-end">
                  <button onClick={handleEmailTestSmtp} className="text-xs text-blue-600 hover:underline">测试 SMTP 连接</button>
                </div>
              </div>

              <p className="text-sm font-semibold text-gray-700 mb-3">收件（IMAP）</p>
              <div className="space-y-2 mb-4">
                <div className="flex items-center gap-2">
                  <label className="w-20 text-sm text-gray-600 text-right shrink-0">服务器</label>
                  <input type="text" value={emailDraft.imapHost} onChange={e => setEmailDraft(d => ({ ...d, imapHost: e.target.value }))} placeholder="imap.qiye.aliyun.com" className={`flex-1 ${inputCls}`} />
                </div>
                <div className="flex items-center gap-2">
                  <label className="w-20 text-sm text-gray-600 text-right shrink-0">端口</label>
                  <select value={emailDraft.imapPort} onChange={e => { const p = Number(e.target.value) as 993|143; setEmailDraft(d => ({ ...d, imapPort: p, imapSsl: p === 993 })) }} className={`w-24 ${inputCls} bg-white`}>
                    <option value={993}>993 (SSL)</option>
                    <option value={143}>143 (非加密)</option>
                  </select>
                  <label className="flex items-center gap-1 text-sm text-gray-600 cursor-pointer">
                    <input type="checkbox" checked={emailDraft.imapSsl} onChange={e => setEmailDraft(d => ({ ...d, imapSsl: e.target.checked }))} className="rounded" /> SSL
                  </label>
                </div>
                {statusBanner(imapTestStatus)}
                <div className="flex justify-end">
                  <button onClick={handleEmailTestImap} className="text-xs text-blue-600 hover:underline">测试 IMAP 连接</button>
                </div>
              </div>

              <div className="space-y-2 mb-5">
                <div className="flex items-center gap-2">
                  <label className="w-20 text-sm text-gray-600 text-right shrink-0">邮箱账号</label>
                  <input type="text" value={emailDraft.username} onChange={e => setEmailDraft(d => ({ ...d, username: e.target.value }))} placeholder="your@company.com" className={`flex-1 ${inputCls}`} />
                </div>
                <div className="flex items-center gap-2">
                  <label className="w-20 text-sm text-gray-600 text-right shrink-0">密码</label>
                  <input type="password" value={emailDraft.password} onChange={e => setEmailDraft(d => ({ ...d, password: e.target.value }))} placeholder="授权码或登录密码" className={`flex-1 ${inputCls}`} />
                </div>
                <div className="flex items-center gap-2">
                  <label className="w-20 text-sm text-gray-600 text-right shrink-0">默认收件人</label>
                  <input type="email" value={emailDraft.defaultRecipient ?? ''} onChange={e => setEmailDraft(d => ({ ...d, defaultRecipient: e.target.value }))} placeholder="cs.frankfurt@dachser.com" className={`flex-1 ${inputCls}`} />
                </div>
                <div className="flex items-start gap-2">
                  <label className="w-20 text-sm text-gray-600 text-right shrink-0 pt-1.5">邮件签名</label>
                  <textarea
                    value={emailDraft.signature ?? ''}
                    onChange={e => setEmailDraft(d => ({ ...d, signature: e.target.value }))}
                    placeholder={'Best regards,\nYour Name\nCompany'}
                    rows={4}
                    className={`flex-1 ${inputCls} resize-none font-mono text-xs`}
                  />
                </div>
                <div className="flex items-start gap-2">
                  <label className="w-20 text-sm text-gray-600 text-right shrink-0 pt-1.5">收件过滤</label>
                  <div className="flex-1 space-y-1">
                    <input
                      type="text"
                      value={(emailDraft.filterKeywords ?? ['dachser']).join(', ')}
                      onChange={e => {
                        const raw = e.target.value
                        const arr = raw.split(',').map(s => s.trim()).filter(Boolean)
                        setEmailDraft(d => ({ ...d, filterKeywords: arr.length ? arr : undefined }))
                      }}
                      placeholder="dachser"
                      className={`w-full ${inputCls} font-mono text-xs`}
                    />
                    <p className="text-[11px] text-gray-400">逗号分隔关键词，邮件 from/to 包含任一即保留（不区分大小写）</p>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={handleEmailSave} disabled={emailSaving} className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm rounded px-4 py-2 transition-colors">
                  {emailSaving ? '保存中…' : '保存邮件配置'}
                </button>
                <button onClick={handleTestSendEmail} disabled={testSending || !emailDraft.username} className="bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 text-gray-700 disabled:text-gray-400 text-sm rounded px-4 py-2 transition-colors border border-gray-300">
                  {testSending ? '发送中…' : '发送测试邮件'}
                </button>
              </div>
              {statusBanner(testSendStatus)}
            </div>

            {/* ── 询价发送方式 ── */}
            <div className="px-6 py-4 border-t border-gray-200 max-w-xl space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">询价发送方式</p>
              <div className="flex items-center gap-3">
                <label className="w-20 text-sm text-gray-600 shrink-0 text-right">发件方式</label>
                <select value={mailClient} onChange={e => { setMailClient(e.target.value as MailClient); saveSetting(SK_CLIENT, e.target.value) }} className={`${inputCls} bg-white`}>
                  <option value="smtp">直接发送（SMTP）</option>
                  <option value="system">系统邮件客户端</option>
                  <option value="webmail">网页邮件（手动粘贴）</option>
                </select>
              </div>
              {mailClient === 'system' && (
                <div className="flex items-center gap-3">
                  <label className="w-20 text-sm text-gray-600 shrink-0 text-right">App 名称</label>
                  <input type="text" value={mailApp} placeholder="Alimail（留空用系统默认）" onChange={e => { setMailApp(e.target.value); saveSetting(SK_MAIL_APP, e.target.value) }} className={`w-56 ${inputCls}`} />
                </div>
              )}
              {mailClient === 'webmail' && (
                <div className="flex items-center gap-3">
                  <label className="w-20 text-sm text-gray-600 shrink-0 text-right">网页地址</label>
                  <input type="url" value={webmailUrl} placeholder="https://mail.company.com" onChange={e => { setWebmailUrl(e.target.value); saveSetting(SK_WEBMAIL_URL, e.target.value) }} className={`w-72 ${inputCls}`} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
