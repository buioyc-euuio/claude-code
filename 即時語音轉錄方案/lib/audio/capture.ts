import { floatToInt16, Int16Chunker, Resampler, rmsLevel } from './pcm'

export type SourceId = 'mic' | 'tab'

export interface CaptureHandlers {
  /** 16kHz mono PCM16，每包 100ms */
  onChunk: (pcm: Int16Array) => void
  onLevel?: (level: number) => void
  /** 使用者在瀏覽器停止分享、或裝置被拔掉 */
  onEnded?: () => void
}

export interface Capture {
  stop(): void
}

export function canCaptureTab(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function'
}

async function getStream(source: SourceId): Promise<MediaStream> {
  if (source === 'mic') {
    return navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
  }

  if (!canCaptureTab()) throw new Error('這個瀏覽器不支援分享分頁音訊（手機瀏覽器都不支援），請改用麥克風。')
  // Chrome 一定要求 video；音訊關掉處理，保持原音給 STT
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    // Chrome 專屬選項：預設選分頁、允許系統音訊、不列出本頁
    preferCurrentTab: false,
    selfBrowserSurface: 'exclude',
    systemAudio: 'include',
  } as DisplayMediaStreamOptions)

  if (stream.getAudioTracks().length === 0) {
    for (const t of stream.getTracks()) t.stop()
    throw new Error('沒有收到音訊：分享時請選「Chrome 分頁」，並勾選「同時分享分頁音訊」。')
  }
  return stream
}

export async function startCapture(source: SourceId, handlers: CaptureHandlers): Promise<Capture> {
  const stream = await getStream(source)
  const ctx = new AudioContext()
  // iOS Safari 在 await 之後建立的 AudioContext 可能是 suspended
  await ctx.resume()
  await ctx.audioWorklet.addModule('/pcm-worklet.js')

  const node = new AudioWorkletNode(ctx, 'pcm-capture')
  const src = ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()))
  src.connect(node)
  // 不接到 destination，避免把會議聲音再播一次造成回音

  const resampler = new Resampler(ctx.sampleRate)
  const chunker = new Int16Chunker()
  let stopped = false

  node.port.onmessage = (ev: MessageEvent<Float32Array>) => {
    if (stopped) return
    const pcm = floatToInt16(resampler.process(ev.data))
    for (const chunk of chunker.push(pcm)) handlers.onChunk(chunk)
    handlers.onLevel?.(rmsLevel(ev.data))
  }

  const stop = () => {
    if (stopped) return
    stopped = true
    node.port.onmessage = null
    src.disconnect()
    node.disconnect()
    for (const t of stream.getTracks()) t.stop()
    void ctx.close()
  }

  for (const t of stream.getAudioTracks()) {
    t.addEventListener('ended', () => {
      stop()
      handlers.onEnded?.()
    })
  }

  return { stop }
}
