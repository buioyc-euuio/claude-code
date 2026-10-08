/**
 * 所有 STT 引擎（雲端 / 本地 / 實驗室 GPU）共用的介面。
 * 之後的 MVP-2（實驗室工作站）、MVP-3（桌面本地）只要再實作一個 Engine 即可。
 */

export type TranscriptEvent =
  /** 進行中的文字（會被下一個 partial 或 final 取代，不含已經 final 的部分） */
  | { type: 'partial'; text: string }
  /** 確定的文字片段；endOfTurn 代表講者告一段落，可以送去翻譯 */
  | { type: 'final'; text: string; endOfTurn: boolean }
  /** 沒有新文字，但講者停頓了（把目前累積的句子收尾） */
  | { type: 'endOfTurn' }

export type EngineStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error'

export interface EngineHandlers {
  onEvent: (e: TranscriptEvent) => void
  onStatus: (s: EngineStatus, detail?: string) => void
}

export interface Engine {
  connect(): Promise<void>
  /** 16kHz mono PCM16 */
  push(pcm: Int16Array): void
  close(): void
}

export type ProviderId = 'deepgram' | 'assemblyai'

export interface EngineOptions {
  /** 從 /api/stt-token 拿到的短效 token */
  token: string
  language: string
  keyterms: string[]
  handlers: EngineHandlers
}
