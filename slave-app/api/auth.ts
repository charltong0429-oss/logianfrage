import type { VercelRequest, VercelResponse } from '@vercel/node'

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const { password } = req.body ?? {}
  if (password && password === process.env.APP_PASSWORD) {
    return res.status(200).json({ ok: true })
  }
  return res.status(401).json({ ok: false })
}
