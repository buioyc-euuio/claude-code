import type { Engine, EngineHandlers, TranscriptEvent } from './types'

interface WsEngineConfig {
  url: string
  protocols?: string[]
  /** 把伺服器訊息轉成共用事件 */
  parse: (msg: unknown) => TranscriptEvent[]
  /** 正常關閉前送出的訊息（讓伺服器把最後一段吐出來） */
  closeMessage?: string
  /** 沒有音訊時保持連線的訊息與間隔 */
  keepAlive?: { message: string; intervalMs: number }
}

/**
 * 「瀏覽器直連 STT WebSocket」的共用實作：
 * 二進位送 PCM16、JSON 收結果。
 */
export class WsEngine implements Engine {
  private ws: WebSocket | null = null
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null
  private lastSend = 0
  private closedByUser = false

  constructor(
    private readonly cfg: WsEngineConfig,
    private readonly handlers: EngineHandlers,
  ) {}

  connect(): Promise<void> {
    this.handlers.onStatus('connecting')
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.cfg.url, this.cfg.protocols)
      ws.binaryType = 'arraybuffer'
      this.ws = ws
      let opened = false

      ws.onopen = () => {
        opened = true
        this.handlers.onStatus('open')
        this.startKeepAlive()
        resolve()
      }
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return
        let msg: unknown
        try {
          msg = JSON.parse(ev.data)
        } catch {
          return
        }
        for (const e of this.cfg.parse(msg)) this.handlers.onEvent(e)
      }
      ws.onerror = () => {
        if (!opened) reject(new Error('無法連線到語音辨識服務'))
      }
      ws.onclose = (ev) => {
        this.stopKeepAlive()
        if (this.closedByUser || ev.code === 1000) {
          this.handlers.onStatus('closed')
        } else {
          this.handlers.onStatus('error', `連線中斷（${ev.code}${ev.reason ? `：${ev.reason}` : ''}）`)
        }
        if (!opened) reject(new Error(`連線被拒絕（${ev.code}${ev.reason ? `：${ev.reason}` : ''}）`))
      }
    })
  }

  push(pcm: Int16Array): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    // 複製一份，避免送出的是共用 buffer 的 view
    this.ws.send(pcm.slice().buffer)
    this.lastSend = Date.now()
  }

  close(): void {
    this.closedByUser = true
    this.stopKeepAlive()
    const ws = this.ws
    if (!ws) return
    if (ws.readyState === WebSocket.OPEN && this.cfg.closeMessage) {
      ws.send(this.cfg.closeMessage)
      // 給伺服器一點時間把最後的結果送回來
      setTimeout(() => ws.close(1000), 1500)
    } else {
      ws.close(1000)
    }
  }

  private startKeepAlive() {
    const ka = this.cfg.keepAlive
    if (!ka) return
    this.keepAliveTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN && Date.now() - this.lastSend > ka.intervalMs) {
        this.ws.send(ka.message)
      }
    }, ka.intervalMs)
  }

  private stopKeepAlive() {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer)
    this.keepAliveTimer = null
  }
}
