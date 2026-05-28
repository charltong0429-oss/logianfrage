import type { SlaveApi } from '../../preload/index'

declare global {
  interface Window {
    api: SlaveApi
  }
}
