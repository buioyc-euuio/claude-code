import type { SourceId } from './audio/capture'
import type { ProviderId } from './engines/types'

export type ViewMode = 'both' | 'en' | 'zh'

export interface Settings {
  provider: ProviderId
  source: SourceId
  /** Deepgram 的 language 參數；AssemblyAI 目前固定英文 */
  language: 'en' | 'multi'
  /** 逗號分隔的專有名詞，提高辨識率（Deepgram Nova-3） */
  keyterms: string
  translate: boolean
  view: ViewMode
  fontSize: number
  passcode: string
}

export const defaultSettings: Settings = {
  provider: 'deepgram',
  source: 'tab',
  language: 'en',
  keyterms: '',
  translate: true,
  view: 'both',
  fontSize: 28,
  passcode: '',
}

const KEY = 'rt-transcribe-settings-v1'

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaultSettings
    return { ...defaultSettings, ...(JSON.parse(raw) as Partial<Settings>) }
  } catch {
    return defaultSettings
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // 私密模式等情況下 localStorage 可能不可用，忽略即可
  }
}

export function parseKeyterms(raw: string): string[] {
  return raw
    .split(/[,，\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50)
}
