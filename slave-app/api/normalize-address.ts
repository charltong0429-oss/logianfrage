import type { VercelRequest, VercelResponse } from '@vercel/node'
import { checkAuth } from './_utils.js'

export interface NormalizedAddress {
  street: string
  postalCode: string
  city: string
  country: string
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!checkAuth(req, res)) return
  if (req.method !== 'POST') return res.status(405).end()

  const { address } = (req.body ?? {}) as { address?: string }
  if (!address?.trim()) return res.status(400).json({ error: 'missing address' })

  const token = process.env.OPENROUTER_TOKEN
  if (!token) return res.status(500).json({ error: 'OPENROUTER_TOKEN not configured' })

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://dachserinquiry.vercel.app',
        'X-Title': 'LogiAnfrage',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        temperature: 0,
        messages: [{
          role: 'user',
          content:
            'Parse this shipping address into JSON with exactly 4 fields:\n' +
            '- street: street name and house number only\n' +
            '- postalCode: the postal/zip code\n' +
            '- city: the city name\n' +
            '- country: 2-letter ISO code (e.g. FR, DE, IT, RO)\n\n' +
            'Return only valid JSON, no markdown, no explanation.\n\n' +
            `Address: ${address}`,
        }],
      }),
    })

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>
      error?: { message: string }
    }

    if (data.error) return res.status(500).json({ error: data.error.message })

    const content = (data.choices?.[0]?.message?.content ?? '')
      .replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(content) as NormalizedAddress
    return res.status(200).json(parsed)
  } catch (e) {
    return res.status(500).json({ error: String(e) })
  }
}
