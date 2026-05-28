/// <reference types="vite/client" />

import type { CargoType, AppConfig, ArchiveRecord, FolderMeta, InquiryStatus, NotionRecord, EmailConfig, EmailMessage, EmailDetail } from './utils/types'
import type { SpeditionsauftragData } from '../main/pdfService'

interface Window {
  api: {
    // Excel
    openAndParseExcel(): Promise<{
      pallets: string; dimensions: string; loadingMeters: string; weight: string
      address1: string; address2: string; address3: string
    } | null>
    parseExcelFile(filePath: string): Promise<{
      pallets: string; dimensions: string; loadingMeters: string; weight: string
      address1: string; address2: string; address3: string
    } | null>
    generateInquiryExcel(params: { record: import('./utils/types').NotionRecord; destFolderPath: string | null }): Promise<{ ok: boolean; filePath?: string; error?: string }>

    // Mail
    openUrl(url: string): Promise<void>
    openWithMailApp(appName: string, url: string): Promise<{ ok: boolean; message?: string }>
    listApps(): Promise<string[]>
    copyToClipboard(text: string): Promise<void>

    // Config
    readAppConfig(): Promise<AppConfig>
    saveAppConfig(config: AppConfig): Promise<{ ok: boolean }>

    // Folder lifecycle
    createArchiveFolder(params: {
      basePath: string; date: string; type: CargoType; country: string
    }): Promise<{ ok: boolean; folderPath?: string; folderName?: string; error?: string }>
    scanFolders(basePath: string): Promise<ArchiveRecord[]>
    renameFolderAppend(params: { currentPath: string; suffix: string }): Promise<{ ok: boolean; newPath?: string; error?: string }>
    moveFilesToFolder(params: { srcPaths: string[]; destFolderPath: string }): Promise<{ ok: boolean; movedFiles?: string[]; error?: string }>
    readFolderMeta(folderPath: string): Promise<FolderMeta | null>
    writeFolderMeta(params: { folderPath: string; meta: FolderMeta }): Promise<{ ok: boolean; error?: string }>
    findFolderByNr(params: { basePath: string; angebotnummer: string }): Promise<string | null>
    openFolderInFinder(folderPath: string): Promise<void>
    selectFolder(): Promise<string | null>
    planFolderRenames(basePath: string): Promise<Array<{
      oldPath: string; newPath: string; oldName: string; newName: string
    }>>
    executeFolderRenames(renames: Array<{
      oldPath: string; newPath: string; oldName: string; newName: string
    }>): Promise<{ ok: boolean; renamed: number; errors: string[] }>

    // PDF parsing
    extractAngebotnummer(filename: string): Promise<{ angebotnummer: string | null }>
    parseRechnungPdf(filePath: string): Promise<{ tagespreisNr: string | null; bruttoAmount: string | null }>
    parsePreisangebotPdf(filePath: string): Promise<{ angebotnummer: string | null; amount: number | null }>
    fillSpeditionsauftrag(params: {
      templatePath: string; data: SpeditionsauftragData; outputPath: string
    }): Promise<{ ok: boolean; error?: string }>
    fillAuftragFromPl(params: {
      folderPath: string; recordType: CargoType
    }): Promise<{ ok: boolean; error?: string; outputFile?: string; outputPath?: string; warnings?: string[] }>

    // Notion — fetch
    notionFetchRecords(): Promise<{ ok: boolean; records: NotionRecord[]; error?: string }>
    notionFetchRecord(pageId: string): Promise<{ ok: boolean; record: NotionRecord | null; error?: string }>

    // Notion — create / update
    notionTestConnection(notionConfig: { token: string; databaseId: string }): Promise<{ ok: boolean; error?: string }>
    notionCheckProperties(): Promise<{ ok: boolean; error?: string; missing?: string[]; typeMismatch?: { name: string; expected: string; actual: string }[]; extra?: string[] }>
    notionCreatePage(params: {
      date: string; type: CargoType; country: string
      address?: string | null; postalCode?: string | null; city?: string | null
      pallets?: number | null; weight?: number | null; volume?: number | null; ldm?: number | null
      folderPath?: string | null; remark?: string | null
    }): Promise<{ ok: boolean; pageId?: string; error?: string }>
    notionUpdatePage(params: {
      pageId: string
      status?: InquiryStatus
      angebotnummer?: string | null
      amount?: number | null
      rswCode?: string | null
      trackingNr?: string | null
      rechnungAmount?: number | null
      folderPath?: string | null
      pallets?: number | null
      weight?: number | null
      ldm?: number | null
    }): Promise<{ ok: boolean; error?: string }>

    // 文件路径（Electron 32+ webUtils）
    getDroppedFilePath(file: File): string

    // Angebot 匹配预览 + 确认
    previewAngebotMatch(filePath: string): Promise<{
      ok: boolean; error?: string
      pdfData: {
        angebotnummer: string | null; amount: number | null; gefahrgut: boolean | null
        destCountryCode: string | null; destZip: string | null; destCity: string | null
        pallets: number | null; volume: number | null; weight: number | null
      }
      candidates: Array<{
        notionPageId: string; date: string; type: string; country: string
        postalCode: string | null; city: string | null
        pallets: number | null; weight: number | null; volume: number | null
        status: string; angebotnummer: string | null
        score: number
        matchDetails: {
          country: boolean | null; typeOk: boolean | null; zip: boolean | null
          pallets: boolean | null; weight: boolean | null; volume: boolean | null
        }
      }>
    }>
    confirmAngebotImport(params: {
      filePath: string; notionPageId: string
      pdfData: {
        angebotnummer: string | null; amount: number | null; gefahrgut: boolean | null
        destCountryCode: string | null; destZip: string | null; destCity: string | null
        pallets: number | null; volume: number | null; weight: number | null
      }
    }): Promise<{
      ok: boolean; action?: string; destPath?: string; error?: string
      record?: { date: string; type: string; country: string; status: string; notionPageId: string }
    }>

    // Rechnung 匹配预览 + 确认
    previewRechnungMatch(filePath: string): Promise<{
      ok: boolean; error?: string
      invoiceNr: string | null
      nettoTotal: number | null
      bruttoTotal: number | null
      positions: Array<{
        positionIndex: number
        tagespreisNr: string | null
        rswCode: string | null
        nettoAmount: number | null
        candidates: Array<{
          notionPageId: string; date: string; type: string; country: string
          status: string; angebotnummer: string | null; rswCode: string | null
          score: number; matchLabel: string | null
        }>
      }>
    }>
    confirmRechnungImport(params: {
      filePath: string
      bruttoTotal: number | null
      nettoTotal: number | null
      invoiceNr: string | null
      matches: Array<{ positionIndex: number; notionPageId: string; nettoAmount: number | null }>
    }): Promise<{
      ok: boolean
      results: Array<{ ok: boolean; notionPageId: string; error?: string }>
    }>

    // Email — SMTP/IMAP
    emailTestSmtp(config: EmailConfig): Promise<{ ok: boolean; error?: string }>
    emailTestImap(config: EmailConfig): Promise<{ ok: boolean; error?: string }>
    emailSend(config: EmailConfig, opts: { to: string; subject: string; body: string }): Promise<{ ok: boolean; error?: string }>
    emailSendSaved(opts: { to: string; subject: string; body: string; attachments?: { path: string; filename: string }[] }): Promise<{ ok: boolean; error?: string }>
    emailListFolders(config: EmailConfig): Promise<{ ok: boolean; folders: Array<{ path: string; name: string; total: number }>; error?: string }>
    emailFetchDachser(config: EmailConfig): Promise<{ ok: boolean; messages: EmailMessage[]; savedAt?: string; error?: string }>
    emailGetCache(): Promise<{ messages: EmailMessage[]; savedAt: string }>
    emailClearCache(): Promise<{ ok: boolean }>
    emailFetchInbox(config: EmailConfig, folder?: string): Promise<{ ok: boolean; messages: EmailMessage[]; error?: string }>
    emailFetchDetail(config: EmailConfig, uid: number, folder?: string): Promise<{ ok: boolean; detail?: EmailDetail; error?: string }>
    emailSaveAttachment(config: EmailConfig, uid: number, attachmentIndex: number, folder?: string): Promise<{ ok: boolean; filePath?: string; filename?: string; error?: string }>

    // 文件导入
    importInquiryExcel(filePath: string): Promise<{
      ok: boolean; action?: string; destPath?: string; error?: string
      record?: { date: string; type: string; country: string; status: string; notionPageId: string }
    }>
    importAngebotPdf(filePath: string): Promise<{
      ok: boolean; action?: string; destPath?: string; error?: string
      record?: { date: string; type: string; country: string; status: string; notionPageId: string }
    }>
    importAuftragPdf(filePath: string): Promise<{
      ok: boolean; action?: string; destPath?: string; error?: string
      record?: { date: string; type: string; country: string; status: string; notionPageId: string }
    }>
    importInvoicePdf(filePath: string): Promise<{
      ok: boolean; action?: string; destPath?: string; error?: string
      record?: { date: string; type: string; country: string; status: string; notionPageId: string }
    }>
  }
}
