import type { VercelRequest, VercelResponse } from '@vercel/node'
import { checkAuth, getNotion, DB_ID } from './_utils.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!checkAuth(req, res)) return

  const env = {
    APP_PASSWORD:        !!process.env.APP_PASSWORD,
    NOTION_TOKEN:        !!process.env.NOTION_TOKEN,
    NOTION_DATABASE_ID:  !!process.env.NOTION_DATABASE_ID,
    DB_ID_tail:          DB_ID ? `…${DB_ID.slice(-8)}` : '(未设置)',
  }

  try {
    const notion = getNotion()
    await notion.databases.retrieve({ database_id: DB_ID })
    return res.status(200).json({ ok: true, env })
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e), env })
  }
}
