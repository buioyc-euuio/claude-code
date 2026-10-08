'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { canCaptureTab, startCapture, type Capture } from '@/lib/audio/capture'
import { createEngine, fetchSttToken, translateStream } from '@/lib/client'
import type { Engine, TranscriptEvent } from '@/lib/engines/types'
import { defaultSettings, loadSettings, parseKeyterms, saveSettings, type Settings } from '@/lib/settings'
import {
  applyEvent,
  contextBefore,
  flush,
  initialTranscript,
  toMarkdown,
  updateLine,
  type Line,
  type TranscriptState,
} from '@/lib/transcript'
import { Captions } from './Captions'
import { openPipWindow, PipPortal, pipSupported } from './PipPortal'

type RunState = 'idle' | 'starting' | 'running' | 'stopping'

/** 引擎還沒連上前最多先暫存幾包音訊（每包 100ms） */
const MAX_PENDING_CHUNKS = 100

export function Transcriber() {
  const [settings, setSettings] = useState<Settings>(defaultSettings)
  const [transcript, setTranscript] = useState<TranscriptState>(initialTranscript)
  const [run, setRun] = useState<RunState>('idle')
  const [error, setError] = useState('')
  const [level, setLevel] = useState(0)
  const [pipWin, setPipWin] = useState<Window | null>(null)
  const [tabSupported, setTabSupported] = useState(true)
  // 只能在瀏覽器判斷，放在 effect 裡避免和伺服器端渲染結果不一致
  const [pipAvailable, setPipAvailable] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  const transcriptRef = useRef(transcript)
  const settingsRef = useRef(settings)
  const engineRef = useRef<Engine | null>(null)
  const captureRef = useRef<Capture | null>(null)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const loaded = loadSettings()
    const tabOk = canCaptureTab()
    setTabSupported(tabOk)
    setPipAvailable(pipSupported())
    setSettings(tabOk ? loaded : { ...loaded, source: 'mic' })
  }, [])

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  const updateSettings = (patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      saveSettings(next)
      return next
    })
  }

  /** 以 ref 為準同步更新，讓事件處理可以立刻拿到「剛收尾的行」 */
  const commit = useCallback((fn: (s: TranscriptState) => TranscriptState) => {
    transcriptRef.current = fn(transcriptRef.current)
    setTranscript(transcriptRef.current)
  }, [])

  const translateLine = useCallback(
    async (line: Line) => {
      const { translate, passcode } = settingsRef.current
      if (!translate) return
      const context = contextBefore(transcriptRef.current, line.id)
      commit((s) => updateLine(s, line.id, { status: 'translating' }))
      try {
        await translateStream(line.en, context, passcode, (zh) => commit((s) => updateLine(s, line.id, { zh })))
        commit((s) => updateLine(s, line.id, { status: 'done' }))
      } catch (err) {
        console.error(err)
        commit((s) => updateLine(s, line.id, { status: 'error' }))
      }
    },
    [commit],
  )

  const handleEvent = useCallback(
    (e: TranscriptEvent) => {
      const { state, closed } = applyEvent(transcriptRef.current, e)
      commit(() => state)
      for (const line of closed) void translateLine(line)
    },
    [commit, translateLine],
  )

  const releaseResources = useCallback(() => {
    captureRef.current?.stop()
    captureRef.current = null
    engineRef.current?.close()
    engineRef.current = null
    void wakeLockRef.current?.release().catch(() => {})
    wakeLockRef.current = null
    setLevel(0)
  }, [])

  const stop = useCallback(() => {
    setRun('stopping')
    releaseResources()
    const { state, closed } = flush(transcriptRef.current)
    commit(() => state)
    for (const line of closed) void translateLine(line)
    setRun('idle')
  }, [commit, releaseResources, translateLine])

  const start = async () => {
    setError('')
    setRun('starting')
    const s = settingsRef.current
    const pending: Int16Array[] = []
    let engineReady = false

    try {
      // 1. 先擷取音訊（分享分頁時使用者要花時間選），期間的音訊先暫存
      captureRef.current = await startCapture(s.source, {
        onChunk: (pcm) => {
          if (engineReady) engineRef.current?.push(pcm)
          else if (pending.length < MAX_PENDING_CHUNKS) pending.push(pcm)
        },
        onLevel: setLevel,
        onEnded: () => stop(),
      })

      // 2. 拿短效 token、直連 STT
      const token = await fetchSttToken(s.provider, s.passcode)
      const engine = createEngine(s.provider, {
        token,
        language: s.language,
        keyterms: parseKeyterms(s.keyterms),
        handlers: {
          onEvent: handleEvent,
          onStatus: (status, detail) => {
            if (status === 'error') {
              setError(detail ?? '語音辨識連線中斷')
              stop()
            }
          },
        },
      })
      engineRef.current = engine
      await engine.connect()

      // 3. 補送暫存的音訊
      for (const pcm of pending) engine.push(pcm)
      pending.length = 0
      engineReady = true

      try {
        wakeLockRef.current = await navigator.wakeLock?.request('screen')
      } catch {
        // 不支援或被拒絕都不影響主要功能
      }
      setRun('running')
    } catch (err) {
      releaseResources()
      setRun('idle')
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg.includes('Permission denied') || msg.includes('NotAllowed') ? '沒有取得麥克風或分享權限' : msg)
    }
  }

  // 頁面關閉時釋放資源
  useEffect(() => () => releaseResources(), [releaseResources])

  // 新字幕出現時，若使用者在底部附近就自動捲動
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 240) el.scrollTop = el.scrollHeight
  }, [transcript])

  const togglePip = async () => {
    if (pipWin) {
      pipWin.close()
      return
    }
    try {
      const win = await openPipWindow()
      win.addEventListener('pagehide', () => setPipWin(null))
      setPipWin(win)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const exportMarkdown = () => {
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
    const blob = new Blob([toMarkdown(transcriptRef.current, `逐字稿 ${stamp}`)], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `transcript-${stamp.replace(/[: ]/g, '-')}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const clear = () => commit(() => initialTranscript)

  const busy = run === 'starting' || run === 'stopping'
  const running = run === 'running'

  return (
    <main className="app">
      <header className="toolbar">
        <h1 className="title">即時字幕</h1>

        <div className="controls">
          <label className="field">
            <span>來源</span>
            <select
              value={settings.source}
              disabled={running || busy}
              onChange={(e) => updateSettings({ source: e.target.value as Settings['source'] })}
            >
              <option value="tab" disabled={!tabSupported}>
                分頁 / 系統音訊{tabSupported ? '' : '（此裝置不支援）'}
              </option>
              <option value="mic">麥克風</option>
            </select>
          </label>

          <label className="field">
            <span>引擎</span>
            <select
              value={settings.provider}
              disabled={running || busy}
              onChange={(e) => updateSettings({ provider: e.target.value as Settings['provider'] })}
            >
              <option value="deepgram">Deepgram Nova-3</option>
              <option value="assemblyai">AssemblyAI</option>
            </select>
          </label>

          <label className="field">
            <span>顯示</span>
            <select value={settings.view} onChange={(e) => updateSettings({ view: e.target.value as Settings['view'] })}>
              <option value="both">中英</option>
              <option value="zh">只有中文</option>
              <option value="en">只有英文</option>
            </select>
          </label>

          <button
            className={running ? 'btn btn-stop' : 'btn btn-start'}
            disabled={busy}
            onClick={running ? stop : start}
          >
            {run === 'starting' ? '連線中…' : running ? '停止' : '開始'}
          </button>
          <div className="level" aria-label="音量">
            <div className="level-bar" style={{ transform: `scaleX(${level})` }} />
          </div>
        </div>

        <div className="controls">
          {pipAvailable && (
            <button className="btn btn-ghost" onClick={togglePip}>
              {pipWin ? '關閉浮動字幕' : '浮動字幕'}
            </button>
          )}
          <button className="btn btn-ghost" onClick={exportMarkdown} disabled={transcript.lines.length === 0}>
            匯出
          </button>
          <button className="btn btn-ghost" onClick={clear} disabled={running || transcript.lines.length === 0}>
            清除
          </button>
          <button className="btn btn-ghost" onClick={() => setShowSettings((v) => !v)}>
            設定
          </button>
        </div>
      </header>

      {showSettings && (
        <section className="settings">
          <label className="field field-wide">
            <span>專有名詞（逗號分隔，提高辨識率，僅 Deepgram）</span>
            <input
              value={settings.keyterms}
              placeholder="seq2seq, ground truth, KU Leuven"
              onChange={(e) => updateSettings({ keyterms: e.target.value })}
            />
          </label>
          <label className="field">
            <span>語言（Deepgram）</span>
            <select
              value={settings.language}
              onChange={(e) => updateSettings({ language: e.target.value as Settings['language'] })}
            >
              <option value="en">英文</option>
              <option value="multi">多語自動偵測</option>
            </select>
          </label>
          <label className="field">
            <span>字級 {settings.fontSize}px</span>
            <input
              type="range"
              min={18}
              max={48}
              value={settings.fontSize}
              onChange={(e) => updateSettings({ fontSize: Number(e.target.value) })}
            />
          </label>
          <label className="field field-check">
            <input
              type="checkbox"
              checked={settings.translate}
              onChange={(e) => updateSettings({ translate: e.target.checked })}
            />
            <span>翻譯成中文</span>
          </label>
          <label className="field">
            <span>通關碼</span>
            <input
              type="password"
              value={settings.passcode}
              autoComplete="off"
              onChange={(e) => updateSettings({ passcode: e.target.value })}
            />
          </label>
        </section>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {settings.source === 'tab' && run === 'idle' && transcript.lines.length === 0 && (
        <p className="hint">
          按「開始」後選擇播放 Meet 或 YouTube 的 <b>Chrome 分頁</b>，並勾選 <b>同時分享分頁音訊</b>。
        </p>
      )}

      <div className="scroll" ref={scrollRef}>
        <Captions
          lines={transcript.lines}
          partial={transcript.partial}
          view={settings.view}
          fontSize={settings.fontSize}
          translate={settings.translate}
        />
      </div>

      {pipWin && (
        <PipPortal win={pipWin}>
          <Captions
            lines={transcript.lines}
            partial={transcript.partial}
            view={settings.view}
            fontSize={settings.fontSize}
            translate={settings.translate}
            compact
          />
        </PipPortal>
      )}
    </main>
  )
}
