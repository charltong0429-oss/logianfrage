import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { CargoType, AppConfig, ArchiveRecord, FolderMeta, InquiryStatus, NotionRecord, EmailConfig, EmailMessage, EmailDetail } from '../renderer/utils/types'
import type { SpeditionsauftragData } from '../main/pdfService'

contextBridge.exposeInMainWorld('api', {
  // ── Excel ──────────────────────────────────────────────────────
  openAndParseExcel: (): Promise<{
    pallets: string; dimensions: string; loadingMeters: string; weight: string
    address1: string; address2: string; address3: string
  } | null> => ipcRenderer.invoke('open-and-parse-excel'),

  parseExcelFile: (filePath: string): Promise<{
    pallets: string; dimensions: string; loadingMeters: string; weight: string
    address1: string; address2: string; address3: string
  } | null> => ipcRenderer.invoke('parse-excel-file', filePath),

  generateInquiryExcel: (params: { record: import('../renderer/utils/types').NotionRecord; destFolderPath: string | null }): Promise<{ ok: boolean; filePath?: string; error?: string }> =>
    ipcRenderer.invoke('generate-inquiry-excel', params),

  // ── Mail ───────────────────────────────────────────────────────
  openUrl: (url: string): Promise<void> =>
    ipcRenderer.invoke('open-url', url),

  openWithMailApp: (appName: string, url: string): Promise<{ ok: boolean; message?: string }> =>
    ipcRenderer.invoke('open-with-mail-app', appName, url),

  listApps: (): Promise<string[]> =>
    ipcRenderer.invoke('list-apps'),

  copyToClipboard: (text: string): Promise<void> =>
    ipcRenderer.invoke('copy-to-clipboard', text),

  // ── Config ─────────────────────────────────────────────────────
  readAppConfig: (): Promise<AppConfig> =>
    ipcRenderer.invoke('read-app-config'),

  saveAppConfig: (config: AppConfig): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('save-app-config', config),

  // ── Folder lifecycle ───────────────────────────────────────────
  createArchiveFolder: (params: {
    basePath: string; date: string; type: CargoType; country: string
  }): Promise<{ ok: boolean; folderPath?: string; folderName?: string; error?: string }> =>
    ipcRenderer.invoke('create-archive-folder', params),

  scanFolders: (basePath: string): Promise<ArchiveRecord[]> =>
    ipcRenderer.invoke('scan-folders', basePath),

  renameFolderAppend: (params: {
    currentPath: string; suffix: string
  }): Promise<{ ok: boolean; newPath?: string; error?: string }> =>
    ipcRenderer.invoke('rename-folder-append', params),

  moveFilesToFolder: (params: {
    srcPaths: string[]; destFolderPath: string
  }): Promise<{ ok: boolean; movedFiles?: string[]; error?: string }> =>
    ipcRenderer.invoke('move-files-to-folder', params),

  readFolderMeta: (folderPath: string): Promise<FolderMeta | null> =>
    ipcRenderer.invoke('read-folder-meta', folderPath),

  writeFolderMeta: (params: { folderPath: string; meta: FolderMeta }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('write-folder-meta', params),

  findFolderByNr: (params: {
    basePath: string; angebotnummer: string
  }): Promise<string | null> =>
    ipcRenderer.invoke('find-folder-by-nr', params),

  openFolderInFinder: (folderPath: string): Promise<void> =>
    ipcRenderer.invoke('open-folder-in-finder', folderPath),

  selectFolder: (): Promise<string | null> =>
    ipcRenderer.invoke('select-folder'),

  planFolderRenames: (basePath: string): Promise<Array<{
    oldPath: string; newPath: string; oldName: string; newName: string
  }>> =>
    ipcRenderer.invoke('plan-folder-renames', basePath),

  executeFolderRenames: (renames: Array<{
    oldPath: string; newPath: string; oldName: string; newName: string
  }>): Promise<{ ok: boolean; renamed: number; errors: string[] }> =>
    ipcRenderer.invoke('execute-folder-renames', renames),

  // ── PDF parsing ────────────────────────────────────────────────
  extractAngebotnummer: (filename: string): Promise<{ angebotnummer: string | null }> =>
    ipcRenderer.invoke('extract-angebotnummer', filename),

  parseRechnungPdf: (filePath: string): Promise<{
    positions: Array<{
      aufNr: string | null
      tagespreisNr: string | null
      rswCode: string | null
      nettoAmount: number | null
      destCountryCode: string | null
      destPostalCode: string | null
    }>
    nettoTotal: number | null
    bruttoTotal: number | null
    tagespreisNr: string | null
    bruttoAmount: string | null
  }> =>
    ipcRenderer.invoke('parse-rechnung-pdf', filePath),

  copyFileToFolders: (params: {
    srcPath: string; destFolderPaths: string[]
  }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('copy-file-to-folders', params),

  parsePreisangebotPdf: (filePath: string): Promise<{
    angebotnummer: string | null; amount: number | null
  }> =>
    ipcRenderer.invoke('parse-preisangebot-pdf', filePath),

  fillSpeditionsauftrag: (params: {
    templatePath: string; data: SpeditionsauftragData; outputPath: string
  }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('fill-speditionsauftrag', params),

  fillAuftragFromPl: (params: {
    folderPath: string; recordType: CargoType
  }): Promise<{ ok: boolean; error?: string; outputFile?: string; outputPath?: string; warnings?: string[] }> =>
    ipcRenderer.invoke('fill-auftrag-from-pl', params),

  // ── Notion — fetch ─────────────────────────────────────────────
  notionFetchRecords: (): Promise<{ ok: boolean; records: NotionRecord[]; error?: string }> =>
    ipcRenderer.invoke('notion-fetch-records'),

  notionFetchRecord: (pageId: string): Promise<{ ok: boolean; record: NotionRecord | null; error?: string }> =>
    ipcRenderer.invoke('notion-fetch-record', pageId),

  // ── Notion — create / update ───────────────────────────────────
  notionTestConnection: (notionConfig: { token: string; databaseId: string }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('notion-test-connection', notionConfig),

  notionCheckProperties: (): Promise<{ ok: boolean; error?: string; missing?: string[]; typeMismatch?: { name: string; expected: string; actual: string }[]; extra?: string[] }> =>
    ipcRenderer.invoke('notion-check-properties'),

  notionCreatePage: (params: {
    date: string; type: CargoType; country: string
    address?: string | null; postalCode?: string | null; city?: string | null
    pallets?: number | null; weight?: number | null; volume?: number | null; ldm?: number | null
    folderPath?: string | null; remark?: string | null
  }): Promise<{ ok: boolean; pageId?: string; error?: string }> =>
    ipcRenderer.invoke('notion-create-page', params),

  notionUpdatePage: (params: {
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
  }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('notion-update-page', params),

  // ── Email ─────────────────────────────────────────────────────────
  emailTestSmtp: (config: EmailConfig): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('email-test-smtp', config),

  emailTestImap: (config: EmailConfig): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('email-test-imap', config),

  emailSend: (config: EmailConfig, opts: {
    to: string; subject: string; body: string
  }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('email-send', config, opts),

  emailSendSaved: (opts: {
    to: string; subject: string; body: string
    attachments?: { path: string; filename: string }[]
  }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('email-send-saved', opts),

  emailListFolders: (config: EmailConfig): Promise<{ ok: boolean; folders: Array<{ path: string; name: string; total: number }>; error?: string }> =>
    ipcRenderer.invoke('email-list-folders', config),

  emailFetchDachser: (config: EmailConfig): Promise<{ ok: boolean; messages: EmailMessage[]; savedAt?: string; error?: string }> =>
    ipcRenderer.invoke('email-fetch-dachser', config),

  emailGetCache: (): Promise<{ messages: EmailMessage[]; savedAt: string }> =>
    ipcRenderer.invoke('email-get-cache'),

  emailClearCache: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('email-clear-cache'),

  emailFetchInbox: (config: EmailConfig, folder?: string): Promise<{ ok: boolean; messages: EmailMessage[]; error?: string }> =>
    ipcRenderer.invoke('email-fetch-inbox', config, folder),

  emailFetchDetail: (config: EmailConfig, uid: number, folder?: string): Promise<{ ok: boolean; detail?: EmailDetail; error?: string }> =>
    ipcRenderer.invoke('email-fetch-detail', config, uid, folder),

  emailSaveAttachment: (config: EmailConfig, uid: number, attachmentIndex: number, folder?: string): Promise<{
    ok: boolean; filePath?: string; filename?: string; error?: string
  }> => ipcRenderer.invoke('email-save-attachment', config, uid, attachmentIndex, folder),

  // ── 文件路径（Electron 32+ 需要 webUtils）────────────────────────
  getDroppedFilePath: (file: File): string => webUtils.getPathForFile(file),

  // ── 文件导入 ──────────────────────────────────────────────────────
  importInquiryExcel: (filePath: string): Promise<{
    ok: boolean; action?: string; destPath?: string; error?: string
    record?: { date: string; type: string; country: string; status: string; notionPageId: string }
  }> => ipcRenderer.invoke('import-inquiry-excel', filePath),

  previewAngebotMatch: (filePath: string): Promise<{
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
  }> => ipcRenderer.invoke('preview-angebot-match', filePath),

  confirmAngebotImport: (params: {
    filePath: string; notionPageId: string
    pdfData: {
      angebotnummer: string | null; amount: number | null; gefahrgut: boolean | null
      destCountryCode: string | null; destZip: string | null; destCity: string | null
      pallets: number | null; volume: number | null; weight: number | null
    }
  }): Promise<{
    ok: boolean; action?: string; destPath?: string; error?: string
    record?: { date: string; type: string; country: string; status: string; notionPageId: string }
  }> => ipcRenderer.invoke('confirm-angebot-import', params),

  importAngebotPdf: (filePath: string): Promise<{
    ok: boolean; action?: string; destPath?: string; error?: string
    record?: { date: string; type: string; country: string; status: string; notionPageId: string }
  }> => ipcRenderer.invoke('import-angebot-pdf', filePath),

  importAuftragPdf: (filePath: string): Promise<{
    ok: boolean; action?: string; destPath?: string; error?: string
    record?: { date: string; type: string; country: string; status: string; notionPageId: string }
  }> => ipcRenderer.invoke('import-auftrag-pdf', filePath),

  previewRechnungMatch: (filePath: string): Promise<{
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
  }> => ipcRenderer.invoke('preview-rechnung-match', filePath),

  confirmRechnungImport: (params: {
    filePath: string
    bruttoTotal: number | null
    nettoTotal: number | null
    invoiceNr: string | null
    matches: Array<{ positionIndex: number; notionPageId: string; nettoAmount: number | null }>
  }): Promise<{
    ok: boolean
    results: Array<{ ok: boolean; notionPageId: string; error?: string }>
  }> => ipcRenderer.invoke('confirm-rechnung-import', params),

  importInvoicePdf: (filePath: string): Promise<{
    ok: boolean; action?: string; destPath?: string; error?: string
    record?: { date: string; type: string; country: string; status: string; notionPageId: string }
  }> => ipcRenderer.invoke('import-invoice-pdf', filePath),
})
