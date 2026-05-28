import React, { useState } from 'react'
import type { AppConfig } from '../utils/types'
import { DEFAULT_BASE_PATH } from '../utils/types'

interface Props {
  config: AppConfig
  onSave: (config: AppConfig) => void
}

export default function NotionSettingsTab({ config, onSave }: Props) {
  const [token, setToken] = useState(config.notion?.token ?? '')
  const [databaseId, setDatabaseId] = useState(config.notion?.databaseId ?? '')
  const [basePath, setBasePath] = useState(config.basePath || DEFAULT_BASE_PATH)
  const [testStatus, setTestStatus] = useState<{ ok: boolean; msg: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [propCheck, setPropCheck] = useState<{ ok: boolean; error?: string; missing?: string[]; typeMismatch?: { name: string; expected: string; actual: string }[]; extra?: string[] } | null>(null)
  const [propChecking, setPropChecking] = useState(false)
  const [showNotion, setShowNotion] = useState(!config.notion)

  async function handleTestAndSave() {
    setSaving(true)
    setTestStatus(null)

    if (token.trim() && databaseId.trim()) {
      const result = await window.api.notionTestConnection({
        token: token.trim(),
        databaseId: databaseId.trim(),
      })
      if (!result.ok) {
        setTestStatus({ ok: false, msg: `连接失败：${result.error ?? '未知错误'}` })
        setSaving(false)
        return
      }
      setTestStatus({ ok: true, msg: '连接成功！' })
    }

    const newConfig: AppConfig = {
      notion: token.trim() && databaseId.trim()
        ? { token: token.trim(), databaseId: databaseId.trim() }
        : null,
      basePath: basePath.trim() || DEFAULT_BASE_PATH,
      email: config.email ?? null,
    }
    await window.api.saveAppConfig(newConfig)
    onSave(newConfig)
    setSaving(false)
  }

  return (
    <div className="px-6 py-5 max-w-xl">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">档案路径</p>

      <div className="flex items-center gap-2 mb-6">
        <label className="w-24 text-sm text-gray-600 shrink-0 text-right">档案根目录</label>
        <input
          type="text"
          value={basePath}
          onChange={(e) => setBasePath(e.target.value)}
          className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 font-mono"
        />
        <button
          type="button"
          onClick={async () => {
            const picked = await window.api.selectFolder()
            if (picked) setBasePath(picked)
          }}
          className="shrink-0 border border-gray-300 rounded px-3 py-1 text-sm text-gray-600 hover:bg-gray-100 transition-colors"
        >
          浏览…
        </button>
      </div>

      <button
        type="button"
        onClick={() => setShowNotion(v => !v)}
        className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4 hover:text-gray-700 transition-colors"
      >
        <span>{showNotion ? '▾' : '▸'}</span>
        <span>Notion 集成</span>
        {config.notion && !showNotion && <span className="normal-case font-normal text-green-600 ml-1">（已配置）</span>}
      </button>

      {showNotion && <>
      {/* Step 1 */}
      <div className="mb-4">
        <p className="text-sm font-semibold text-gray-700 mb-1">第一步：创建集成（Integration）</p>
        <ol className="text-xs text-gray-600 space-y-1 mb-2 list-none">
          <li>① 点击下方链接，在浏览器中打开 Notion 集成管理页</li>
          <li>② 点击右上角 <span className="bg-gray-100 px-1 rounded font-mono">新建集成</span>（New integration）</li>
          <li>③ 名称随意填写（如 <span className="bg-gray-100 px-1 rounded font-mono">LogiAnfrage</span>），关联空间选你自己的工作区</li>
          <li>④ 点击 <span className="bg-gray-100 px-1 rounded font-mono">保存</span>，页面会显示一串 <span className="bg-gray-100 px-1 rounded font-mono">ntn_xxx...</span> 密钥</li>
        </ol>
        <button
          onClick={() => window.api.openUrl('https://www.notion.so/my-integrations')}
          className="text-xs text-blue-500 hover:underline"
        >
          打开 notion.so/my-integrations →
        </button>
      </div>

      {/* Step 2 */}
      <div className="mb-4">
        <p className="text-sm font-semibold text-gray-700 mb-1">第二步：粘贴密钥（Token）</p>
        <p className="text-xs text-gray-500 mb-2">
          复制上一步生成的 <span className="bg-gray-100 px-1 rounded font-mono">ntn_xxx...</span> 字符串，粘贴到下方
        </p>
        <div className="flex items-center gap-2">
          <label className="w-24 text-sm text-gray-600 shrink-0 text-right">密钥</label>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="ntn_xxxxxxxxxxxxxxxx"
            className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 font-mono"
          />
        </div>
      </div>

      {/* Step 3 */}
      <div className="mb-4">
        <p className="text-sm font-semibold text-gray-700 mb-1">第三步：在 Notion 创建数据库并添加属性</p>
        <ol className="text-xs text-gray-600 space-y-1 mb-2 list-none">
          <li>① 在 Notion 中新建一个<strong>整页数据库</strong>（页面类型选"表格"）</li>
          <li>② 按下表依次添加属性列（点击列标题旁的 <span className="bg-gray-100 px-1 rounded">+</span> 添加，<strong>属性名称必须完全一致</strong>）</li>
        </ol>
        <div className="bg-gray-50 border border-gray-200 rounded px-3 py-2 text-xs text-gray-600 space-y-0.5 mb-2">
          {[
            ['日期', '日期（Date）'],
            ['目的国', '单选（Select）'],
            ['类型', '单选（Select）— 选项：INV / BATT / ACC'],
            ['状态', '单选（Select）— 选项：询价中 / 报价已收 / 已发货 / 已收账单'],
            ['托盘数', '文本（Text）'],
            ['重量', '文本（Text）'],
            ['LDM', '文本（Text）'],
            ['Preisangebot Nr', '文本（Text）'],
            ['Pickup#', '文本（Text）'],
            ['账单金额', '数字（Number）'],
            ['文件夹路径', '文本（Text）'],
          ].map(([name, type]) => (
            <div key={name} className="flex gap-2">
              <span className="font-medium w-36 shrink-0">{name}</span>
              <span className="text-gray-400">{type}</span>
            </div>
          ))}
        </div>
        <ol className="text-xs text-gray-600 space-y-1 list-none">
          <li>③ 数据库建好后，点击右上角 <span className="bg-gray-100 px-1 rounded">···</span> 菜单 →
            <span className="bg-gray-100 px-1 rounded mx-1">连接</span>（Connections）→
            搜索刚才创建的集成名称（如 <span className="bg-gray-100 px-1 rounded font-mono">LogiAnfrage</span>）→ 点击确认
          </li>
        </ol>
      </div>

      {/* Step 4 */}
      <div className="mb-5">
        <p className="text-sm font-semibold text-gray-700 mb-1">第四步：获取 Database ID</p>
        <ol className="text-xs text-gray-600 space-y-1 mb-2 list-none">
          <li>① 在浏览器中打开该数据库页面（点击 Notion 右上角 <span className="bg-gray-100 px-1 rounded">分享</span> → <span className="bg-gray-100 px-1 rounded">复制链接</span>）</li>
          <li>② URL 格式为：<span className="bg-gray-100 px-1 rounded font-mono text-gray-500">notion.so/你的工作区/<strong className="text-gray-700">xxxxxxxx...32位</strong>?v=...</span></li>
          <li>③ 复制 <strong>?v= 之前</strong>的那段 32 位字符串，粘贴到下方</li>
        </ol>
        <div className="flex items-center gap-2">
          <label className="w-24 text-sm text-gray-600 shrink-0 text-right">Database ID</label>
          <input
            type="text"
            value={databaseId}
            onChange={(e) => setDatabaseId(e.target.value)}
            placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 font-mono"
          />
        </div>
      </div>

      {/* Test status */}
      {testStatus && (
        <div className={`mb-3 px-3 py-2 rounded text-xs border ${
          testStatus.ok
            ? 'bg-green-50 border-green-200 text-green-700'
            : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          {testStatus.msg}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={handleTestAndSave}
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm rounded px-4 py-2 transition-colors"
        >
          {saving ? '测试中…' : '保存并测试连接'}
        </button>
        <button
          onClick={async () => {
            setPropChecking(true)
            setPropCheck(null)
            const r = await window.api.notionCheckProperties()
            setPropCheck(r)
            setPropChecking(false)
          }}
          disabled={propChecking || !config.notion}
          className="bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 text-gray-700 disabled:text-gray-400 text-sm rounded px-4 py-2 transition-colors border border-gray-300"
        >
          {propChecking ? '检测中…' : '检测属性列'}
        </button>
      </div>

      {propCheck && (
        <div className={`mt-3 px-3 py-2.5 rounded text-xs border space-y-1.5 ${
          propCheck.ok
            ? 'bg-green-50 border-green-200 text-green-700'
            : 'bg-amber-50 border-amber-200 text-amber-700'
        }`}>
          {propCheck.error ? (
            <p>检测失败：{propCheck.error}</p>
          ) : propCheck.ok ? (
            <p>所有属性列均存在且类型匹配 ✓</p>
          ) : (
            <>
              {(propCheck.missing?.length ?? 0) > 0 && (
                <div>
                  <p className="font-semibold text-red-600">缺少属性列（{propCheck.missing!.length}）：</p>
                  <ul className="mt-0.5 space-y-0.5 pl-2">
                    {propCheck.missing!.map(n => <li key={n} className="font-mono">{n}</li>)}
                  </ul>
                </div>
              )}
              {(propCheck.typeMismatch?.length ?? 0) > 0 && (
                <div>
                  <p className="font-semibold text-orange-600">属性类型不匹配（{propCheck.typeMismatch!.length}）：</p>
                  <ul className="mt-0.5 space-y-0.5 pl-2">
                    {propCheck.typeMismatch!.map(m => (
                      <li key={m.name} className="font-mono">{m.name}：期望 {m.expected}，实际 {m.actual}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
          {(propCheck.extra?.length ?? 0) > 0 && (
            <p className="text-gray-400">其他属性列（不影响使用）：{propCheck.extra!.join('、')}</p>
          )}
        </div>
      )}
      </>}
    </div>
  )
}
