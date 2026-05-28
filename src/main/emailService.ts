import nodemailer from 'nodemailer'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { EmailConfig, EmailMessage, EmailDetail, EmailAttachment } from '../renderer/utils/types'

// ── 邮件缓存 ──────────────────────────────────────────────────────────────────

interface FolderMeta { highestUid: number; uidValidity: number }

export interface EmailCache {
  version: 2
  savedAt: string             // ISO 时间戳
  messages: EmailMessage[]
  folders: Record<string, FolderMeta>
}

const CACHE_FILENAME = 'email-cache.json'
const CACHE_VERSION = 2

function emptyCache(): EmailCache {
  return { version: 2, savedAt: '', messages: [], folders: {} }
}

export function loadEmailCache(userData: string): EmailCache {
  try {
    const p = join(userData, CACHE_FILENAME)
    if (!existsSync(p)) return emptyCache()
    const parsed = JSON.parse(readFileSync(p, 'utf-8')) as EmailCache
    if (parsed.version !== CACHE_VERSION) return emptyCache()
    return parsed
  } catch {
    return emptyCache()
  }
}

export function saveEmailCache(userData: string, cache: EmailCache): void {
  try {
    writeFileSync(join(userData, CACHE_FILENAME), JSON.stringify(cache), 'utf-8')
  } catch { /* ignore */ }
}

export function clearEmailCache(userData: string): void {
  try {
    const p = join(userData, CACHE_FILENAME)
    if (existsSync(p)) unlinkSync(p)
  } catch { /* ignore */ }
}

// ── SMTP 发送 ─────────────────────────────────────────────────────────────────

export interface SendEmailOptions {
  to: string | string[]
  subject: string
  body: string          // 纯文本正文
  attachments?: { path: string; filename: string }[]
}

export async function sendEmail(config: EmailConfig, opts: SendEmailOptions): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSsl,
    auth: { user: config.username, pass: config.password },
    tls: { rejectUnauthorized: false },
  })

  const body = config.signature ? `${opts.body}\n\n${config.signature}` : opts.body

  await transporter.sendMail({
    from: config.username,
    to: Array.isArray(opts.to) ? opts.to.join(', ') : opts.to,
    subject: opts.subject,
    text: body,
    attachments: opts.attachments?.map(a => ({ filename: a.filename, path: a.path })),
  })
}

export async function testSmtp(config: EmailConfig): Promise<void> {
  const t = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSsl,
    auth: { user: config.username, pass: config.password },
    tls: { rejectUnauthorized: false },
  })
  await t.verify()
}

// ── IMAP 工具 ─────────────────────────────────────────────────────────────────

function makeClient(config: EmailConfig): ImapFlow {
  return new ImapFlow({
    host: config.imapHost,
    port: config.imapPort,
    secure: config.imapSsl,
    auth: { user: config.username, pass: config.password },
    tls: { rejectUnauthorized: false },
    logger: false,
  })
}

// ── 获取收件箱列表 ────────────────────────────────────────────────────────────

export async function fetchInbox(config: EmailConfig, limit = 80, folder = 'INBOX'): Promise<EmailMessage[]> {
  const client = makeClient(config)
  await client.connect()
  const messages: EmailMessage[] = []

  try {
    const mailboxInfo = await client.mailboxOpen(folder)
    const total = mailboxInfo.exists ?? 0
    if (total === 0) return []

    const start = Math.max(1, total - limit + 1)
    for await (const msg of client.fetch(`${start}:*`, {
      uid: true, flags: true, envelope: true,
      bodyStructure: true,
    })) {
      const from = msg.envelope?.from?.[0]
        ? `${msg.envelope.from[0].name ?? ''} <${msg.envelope.from[0].address ?? ''}>`.trim()
        : '未知'

      messages.push({
        uid: msg.uid,
        from,
        subject: msg.envelope?.subject ?? '（无主题）',
        date: msg.envelope?.date?.toISOString() ?? '',
        hasAttachment: hasAttachmentInBody(msg.bodyStructure),
        seen: msg.flags?.has('\\Seen') ?? false,
      })
    }
  } finally {
    await client.logout()
  }

  return messages.reverse()
}

// ── 获取单封邮件详情 + 附件列表 ───────────────────────────────────────────────

export async function fetchMessageDetail(config: EmailConfig, uid: number, folder = 'INBOX'): Promise<EmailDetail> {
  const client = makeClient(config)
  await client.connect()

  try {
    await client.mailboxOpen(folder)
    const dl = await client.fetchOne(`${uid}`, { source: true }, { uid: true })
    if (!dl?.source) throw new Error('邮件不存在')

    const parsed = await simpleParser(dl.source)

    const attachments: EmailAttachment[] = (parsed.attachments ?? []).map((a, i) => ({
      index: i,
      filename: a.filename ?? `attachment-${i}`,
      size: a.size ?? a.content.length,
      contentType: a.contentType,
    }))

    const from = parsed.from?.text ?? ''
    return {
      uid,
      from,
      subject: parsed.subject ?? '（无主题）',
      date: parsed.date?.toISOString() ?? '',
      hasAttachment: attachments.length > 0,
      seen: true,
      bodyHtml: parsed.html || null,
      bodyText: parsed.text || null,
      attachments,
    }
  } finally {
    await client.logout()
  }
}

// ── 保存附件到临时目录，返回文件路径 ──────────────────────────────────────────

export async function saveAttachmentToTemp(
  config: EmailConfig,
  uid: number,
  attachmentIndex: number,
  folder = 'INBOX',
): Promise<{ filePath: string; filename: string }> {
  const client = makeClient(config)
  await client.connect()

  try {
    await client.mailboxOpen(folder)
    const dl = await client.fetchOne(`${uid}`, { source: true }, { uid: true })
    if (!dl?.source) throw new Error('邮件不存在')

    const parsed = await simpleParser(dl.source)
    const att = parsed.attachments?.[attachmentIndex]
    if (!att) throw new Error('附件不存在')

    const filename = att.filename ?? `attachment-${attachmentIndex}`
    const filePath = join(tmpdir(), `logianfrage-${uid}-${attachmentIndex}-${filename}`)
    writeFileSync(filePath, att.content)
    return { filePath, filename }
  } finally {
    await client.logout()
  }
}

export async function testImap(config: EmailConfig): Promise<void> {
  const client = makeClient(config)
  await client.connect()
  await client.logout()
}

// ── 扫描所有文件夹，汇总所有与 dachser.com 相关的邮件 ────────────────────────

// 只扫描这些文件夹（路径前缀匹配，含子文件夹）
const SCAN_FOLDERS = ['INBOX', '已发送', '物流运输']

// 每个文件夹最多拉取的信封数量
const PER_FOLDER_LIMIT = 300

export async function fetchAllDachserEmails(config: EmailConfig): Promise<EmailMessage[]> {
  const client = makeClient(config)
  await client.connect()
  const results: EmailMessage[] = []

  try {
    const boxes = await client.list()
    const targets = boxes.filter(b =>
      SCAN_FOLDERS.some(f => b.path === f || b.path.startsWith(f + '/'))
    )
    console.log('[email] 扫描文件夹:', targets.map(b => b.path).join(', '))

    for (const box of targets) {
      try {
        const mailboxInfo = await client.mailboxOpen(box.path)
        const total = mailboxInfo.exists ?? 0
        if (total === 0) continue

        // 本地过滤：拉最近 PER_FOLDER_LIMIT 封的信封，不依赖 IMAP SEARCH
        const start = Math.max(1, total - PER_FOLDER_LIMIT + 1)
        for await (const msg of client.fetch(`${start}:*`, {
          uid: true, flags: true, envelope: true, bodyStructure: true,
        })) {
          const fromAddr = msg.envelope?.from?.[0]
          const toAddrs  = msg.envelope?.to ?? []

          const fromStr = fromAddr
            ? `${fromAddr.name ?? ''} <${fromAddr.address ?? ''}>`.trim()
            : ''
          const toStr = toAddrs
            .map(a => a.address ?? '')
            .join(' ')

          // 本地过滤：from 或 to 包含任一关键词
          const keywords = config.filterKeywords?.length ? config.filterKeywords : ['dachser']
          const combined = `${fromStr} ${toStr}`.toLowerCase()
          if (!keywords.some(k => combined.includes(k.toLowerCase()))) continue

          results.push({
            uid: msg.uid,
            from: fromStr,
            subject: msg.envelope?.subject ?? '（无主题）',
            date: msg.envelope?.date?.toISOString() ?? '',
            hasAttachment: hasAttachmentInBody(msg.bodyStructure),
            seen: msg.flags?.has('\\Seen') ?? false,
            folder: box.path,
          })
        }

        console.log(`[email] ${box.path}: 找到 ${results.filter(r => r.folder === box.path).length} 封 Dachser 邮件`)
      } catch (e) {
        console.log(`[email] 跳过文件夹 ${box.path}:`, String(e))
      }
    }
    console.log(`[email] 扫描完成，共 ${results.length} 封`)
  } finally {
    await client.logout()
  }

  results.sort((a, b) => {
    const ta = a.date ? new Date(a.date).getTime() : 0
    const tb = b.date ? new Date(b.date).getTime() : 0
    return tb - ta
  })

  return results
}

// ── 增量扫描（带本地缓存） ────────────────────────────────────────────────────

function hasAttachmentInBody(bodyStructure: unknown): boolean {
  if (!bodyStructure || typeof bodyStructure !== 'object') return false
  const p = bodyStructure as Record<string, unknown>
  if (p.disposition === 'attachment') return true
  if (p.type === 'application') return true
  if (Array.isArray(p.childNodes)) return p.childNodes.some(hasAttachmentInBody)
  return false
}

/**
 * 增量拉取 Dachser 往来邮件。
 * 首次调用：按序号拉取最近 PER_FOLDER_LIMIT 封（写入缓存）。
 * 后续调用：仅拉取 UID > highestUid 的新邮件（快速）。
 */
export async function fetchDachserEmailsIncremental(
  config: EmailConfig,
  userData: string,
): Promise<{ messages: EmailMessage[]; savedAt: string }> {
  const cache = loadEmailCache(userData)
  const client = makeClient(config)
  await client.connect()

  const newMessages: EmailMessage[] = []
  const updatedFolders: Record<string, FolderMeta> = { ...cache.folders }
  const invalidatedFolders = new Set<string>()

  try {
    const boxes = await client.list()
    const targets = boxes.filter(b =>
      SCAN_FOLDERS.some(f => b.path === f || b.path.startsWith(f + '/'))
    )
    console.log('[email-cache] 扫描文件夹:', targets.map(b => b.path).join(', '))

    for (const box of targets) {
      try {
        const mailboxInfo = await client.mailboxOpen(box.path)
        const total = mailboxInfo.exists ?? 0
        if (total === 0) continue

        const cachedFolder = cache.folders[box.path]
        const serverUidValidity = Number(mailboxInfo.uidValidity ?? 0)
        const cachedUidValidity = cachedFolder?.uidValidity ?? 0
        const uidValidityChanged = cachedUidValidity !== 0 && cachedUidValidity !== serverUidValidity

        if (uidValidityChanged) {
          console.log(`[email-cache] ${box.path}: UIDVALIDITY 变更，重新扫描`)
          invalidatedFolders.add(box.path)
        }

        const lastUid = (uidValidityChanged || !cachedFolder) ? 0 : cachedFolder.highestUid
        let maxUidSeen = lastUid

        let uidRange: string
        let useUidMode: boolean

        if (lastUid > 0) {
          uidRange = `${lastUid + 1}:*`
          useUidMode = true
        } else {
          uidRange = `${Math.max(1, total - PER_FOLDER_LIMIT + 1)}:*`
          useUidMode = false
        }

        const fetchOptions = useUidMode ? { uid: true } : undefined
        for await (const msg of client.fetch(uidRange, {
          uid: true, flags: true, envelope: true, bodyStructure: true,
        }, fetchOptions)) {
          if (msg.uid > maxUidSeen) maxUidSeen = msg.uid

          const fromAddr = msg.envelope?.from?.[0]
          const toAddrs = msg.envelope?.to ?? []
          const fromStr = fromAddr ? `${fromAddr.name ?? ''} <${fromAddr.address ?? ''}>`.trim() : ''
          const toStr = toAddrs.map(a => a.address ?? '').join(' ')

          const keywords2 = config.filterKeywords?.length ? config.filterKeywords : ['dachser']
          const combined2 = `${fromStr} ${toStr}`.toLowerCase()
          if (!keywords2.some(k => combined2.includes(k.toLowerCase()))) continue

          newMessages.push({
            uid: msg.uid,
            from: fromStr,
            subject: msg.envelope?.subject ?? '（无主题）',
            date: msg.envelope?.date?.toISOString() ?? '',
            hasAttachment: hasAttachmentInBody(msg.bodyStructure),
            seen: msg.flags?.has('\\Seen') ?? false,
            folder: box.path,
          })
        }

        updatedFolders[box.path] = { highestUid: maxUidSeen, uidValidity: serverUidValidity }
        const added = newMessages.filter(m => m.folder === box.path).length
        console.log(`[email-cache] ${box.path}: +${added} 新邮件, UID up to ${maxUidSeen}`)
      } catch (e) {
        console.log(`[email-cache] 跳过 ${box.path}:`, String(e))
      }
    }
  } finally {
    await client.logout()
  }

  // Merge: start from cached messages, remove invalidated folders, add new messages
  let base = cache.messages.filter(m => !invalidatedFolders.has(m.folder))
  const msgMap = new Map(base.map(m => [`${m.folder}:${m.uid}`, m]))
  for (const m of newMessages) msgMap.set(`${m.folder}:${m.uid}`, m)

  const merged = Array.from(msgMap.values()).sort((a, b) => {
    const ta = a.date ? new Date(a.date).getTime() : 0
    const tb = b.date ? new Date(b.date).getTime() : 0
    return tb - ta
  })

  const savedAt = new Date().toISOString()
  saveEmailCache(userData, { version: 2, savedAt, messages: merged, folders: updatedFolders })
  console.log(`[email-cache] 完成，共 ${merged.length} 封（新增 ${newMessages.length} 封）`)
  return { messages: merged, savedAt }
}

// ── 列出所有邮件文件夹 ────────────────────────────────────────────────────────

export async function listMailboxFolders(config: EmailConfig): Promise<Array<{ path: string; name: string; total: number }>> {
  const client = makeClient(config)
  await client.connect()
  try {
    const boxes = await client.list()
    const result: Array<{ path: string; name: string; total: number }> = []
    for (const box of boxes) {
      try {
        const s = await client.status(box.path, { messages: true })
        result.push({ path: box.path, name: box.name, total: s.messages ?? 0 })
      } catch {
        result.push({ path: box.path, name: box.name, total: 0 })
      }
    }
    return result
  } finally {
    await client.logout()
  }
}
