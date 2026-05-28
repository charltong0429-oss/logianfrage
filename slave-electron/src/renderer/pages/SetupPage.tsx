import { useEffect, useState } from 'react'

export default function SetupPage({ onSaved }: { onSaved: () => void }) {
  const [token, setToken]               = useState('')
  const [dbId, setDbId]                 = useState('')
  const [openrouterToken, setOpenrouter] = useState('')
  const [testing, setTesting]           = useState(false)
  const [saving, setSaving]             = useState(false)
  const [saveError, setSaveError]       = useState('')
  const [testResult, setTestResult]     = useState<{ ok: boolean; error?: string } | null>(null)

  useEffect(() => {
    window.api.getConfig().then(cfg => {
      if (cfg.notion) {
        setToken(cfg.notion.token)
        setDbId(cfg.notion.databaseId)
      }
      if (cfg.openrouterToken) setOpenrouter(cfg.openrouterToken)
    })
  }, [])

  async function handleTest() {
    setTesting(true); setTestResult(null)
    const r = await window.api.testConnection({ token: token.trim(), databaseId: dbId.trim() })
    setTestResult(r); setTesting(false)
  }

  async function handleSave() {
    setSaving(true); setSaveError('')
    try {
      const res = await window.api.saveConfig(
        { token: token.trim(), databaseId: dbId.trim() },
        openrouterToken.trim() || undefined,
      )
      if (!res.ok) throw new Error(res.error ?? '保存失败')
      onSaved()
    } catch (e) {
      setSaveError(String(e))
    } finally {
      setSaving(false)
    }
  }

  const canSave = token.trim().length > 10 && dbId.trim().length > 10

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-2xl border border-gray-200 p-8 shadow-sm space-y-5">
        <div>
          <h1 className="text-xl font-bold text-gray-800">LogiAnfrage 配置</h1>
          <p className="text-sm text-gray-500 mt-1">首次使用需填写 Notion 连接信息</p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Notion Integration Token
            </label>
            <input
              type="password"
              value={token}
              onChange={e => setToken(e.target.value)}
              placeholder="secret_xxxxxxxxxxxx"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Database ID
            </label>
            <input
              type="text"
              value={dbId}
              onChange={e => setDbId(e.target.value)}
              placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              OpenRouter API Key
              <span className="ml-1 font-normal text-gray-400">（地址 AI 解析，可选）</span>
            </label>
            <input
              type="password"
              value={openrouterToken}
              onChange={e => setOpenrouter(e.target.value)}
              placeholder="sk-or-v1-xxxxxxxxxxxx"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
        </div>

        {testResult && (
          <div className={`rounded-lg p-3 text-sm ${testResult.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-600 border border-red-200'}`}>
            {testResult.ok ? '✓ 连接成功' : `✗ ${testResult.error}`}
          </div>
        )}

        {saveError && (
          <div className="rounded-lg p-3 text-sm bg-red-50 text-red-600 border border-red-200">
            ✗ {saveError}
          </div>
        )}

        <div className="flex gap-3 pt-1">
          <button
            onClick={handleTest}
            disabled={testing || !canSave}
            className="flex-1 border border-gray-300 hover:border-gray-400 disabled:opacity-50 text-gray-700 rounded-lg py-2 text-sm font-medium transition-colors"
          >
            {testing ? '测试中…' : '测试连接'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !canSave}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg py-2 text-sm font-medium transition-colors"
          >
            {saving ? '保存中…' : '保存并进入'}
          </button>
        </div>

        <p className="text-xs text-gray-400 text-center">
          配置信息仅保存在本机，不上传任何服务器
        </p>
      </div>
    </div>
  )
}
