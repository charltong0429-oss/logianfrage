import type { VercelRequest, VercelResponse } from '@vercel/node'
import { checkAuth, getNotion, DB_ID, parseNotionPage, richText } from './_utils.js'
import type { PageObjectResponse, QueryDatabaseResponse } from '@notionhq/client/build/src/api-endpoints'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!checkAuth(req, res)) return

  if (req.method === 'GET') {
    try {
      const notion = getNotion()
      const records = []
      let cursor: string | undefined = undefined

      do {
        const response: QueryDatabaseResponse = await notion.databases.query({
          database_id: DB_ID,
          sorts: [{ property: '日期', direction: 'descending' }],
          start_cursor: cursor,
          page_size: 100,
        })
        for (const page of response.results) {
          if (page.object === 'page' && 'properties' in page) {
            records.push(parseNotionPage(page as PageObjectResponse))
          }
        }
        cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined
      } while (cursor)

      const { status } = req.query
      const filtered = status
        ? records.filter(r => r.status === status)
        : records

      return res.status(200).json(filtered)
    } catch (e) {
      return res.status(500).json({ error: String(e) })
    }
  }

  if (req.method === 'POST') {
    try {
      const notion = getNotion()
      const params = req.body ?? {}
      const today = new Date()
      const date = params.date ?? `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, '0')}.${String(today.getDate()).padStart(2, '0')}`
      const isoDate = date.replace(/\./g, '-')

      const properties: Record<string, unknown> = {
        '日期': { date: { start: isoDate } },
        '类型': { select: { name: params.type ?? 'INV' } },
        '状态': { select: { name: '待询价' } },
      }
      if (params.country)    properties['目的国']  = { select: { name: params.country } }
      if (params.address)    properties['地址']    = richText(params.address)
      if (params.postalCode) properties['邮编']    = richText(params.postalCode)
      if (params.city)       properties['城市']    = richText(params.city)
      if (params.pallets != null) properties['托盘数'] = { number: Number(params.pallets) }
      if (params.weight  != null) properties['重量']   = { number: Number(params.weight) }
      if (params.volume  != null) properties['体积']   = { number: Number(params.volume) }
      if (params.ldm        != null) properties['LDM']  = { number: Number(params.ldm) }
      if (params.dimensions)        properties['尺寸']  = richText(params.dimensions)
      if (params.remark)            properties['备注']  = richText(params.remark)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const page = await notion.pages.create({
        parent: { database_id: DB_ID },
        properties: properties as any,
      })
      return res.status(201).json({ pageId: page.id })
    } catch (e) {
      return res.status(500).json({ error: String(e) })
    }
  }

  return res.status(405).end()
}
