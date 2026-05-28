import { contextBridge, ipcRenderer } from 'electron'
import type { NotionRecord, CreateRecordParams, UpdateRecordParams, NotionConfig } from '../main/notionService'

export interface NormalizedAddress {
  street: string; postalCode: string; city: string; country: string
}

export interface SlaveApi {
  getConfig(): Promise<{ notion?: NotionConfig; openrouterToken?: string }>
  saveConfig(notion: NotionConfig, openrouterToken?: string): Promise<{ ok: boolean; error?: string }>
  testConnection(notion: NotionConfig): Promise<{ ok: boolean; error?: string }>
  getRecords(): Promise<{ ok: boolean; error?: string; records: NotionRecord[] }>
  getRecord(pageId: string): Promise<{ ok: boolean; error?: string; record: NotionRecord | null }>
  createRecord(params: CreateRecordParams): Promise<{ ok: boolean; error?: string; pageId?: string }>
  updateRecord(pageId: string, params: UpdateRecordParams): Promise<{ ok: boolean; error?: string }>
  normalizeAddress(raw: string): Promise<{ ok: boolean; error?: string; data?: NormalizedAddress }>
}

contextBridge.exposeInMainWorld('api', {
  getConfig:        ()                           => ipcRenderer.invoke('slave:getConfig'),
  saveConfig:       (notion, openrouterToken)    => ipcRenderer.invoke('slave:saveConfig', notion, openrouterToken),
  testConnection:   (notion)                     => ipcRenderer.invoke('slave:testConnection', notion),
  getRecords:       ()                           => ipcRenderer.invoke('slave:getRecords'),
  getRecord:        (pageId)                     => ipcRenderer.invoke('slave:getRecord', pageId),
  createRecord:     (params)                     => ipcRenderer.invoke('slave:createRecord', params),
  updateRecord:     (pageId, params)             => ipcRenderer.invoke('slave:updateRecord', pageId, params),
  normalizeAddress: (raw)                        => ipcRenderer.invoke('slave:normalizeAddress', raw),
} satisfies SlaveApi)
