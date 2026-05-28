import type { VercelRequest, VercelResponse } from '@vercel/node'
import { checkAuth, getNotion, parseNotionPage, richText } from '../_utils.js'
import type { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!checkAuth(req, res)) return
  const { id } = req.query
  if (typeof id !== 'string') return res.status(400).json({ error: 'missing id' })

  if (req.method === 'GET') {
    try {
      const notion = getNotion()
      const page = await notion.pages.retrieve({ page_id: id })
      if (!('properties' in page)) return res.status(404).json({ error: 'not found' })
      return res.status(200).json(parseNotionPage(page as PageObjectResponse))
    } catch (e) {
      return res.status(500).json({ error: String(e) })
    }
  }

  if (req.method === 'PATCH') {
    try {
      const notion = getNotion()
      const params = req.body ?? {}
      const properties: Record<string, unknown> = {}

      if (params.status !== undefined)
        properties['状态'] = { select: { name: params.status } }
      if (params.rswCode != null && params.rswCode !== '')
        properties['Pickup#'] = richText(params.rswCode)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await notion.pages.update({ page_id: id, properties: properties as any })
      return res.status(200).json({ ok: true })
    } catch (e) {
      return res.status(500).json({ error: String(e) })
    }
  }

  return res.status(405).end()
}
