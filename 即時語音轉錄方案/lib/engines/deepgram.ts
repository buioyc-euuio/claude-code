import { TARGET_SAMPLE_RATE } from '../audio/pcm'
import type { EngineOptions, TranscriptEvent } from './types'
import { WsEngine } from './ws-engine'

const DEEPGRAM_LISTEN_URL = 'wss://api.deepgram.com/v1/listen'

export function buildDeepgramUrl(language: string, keyterms: string[]): string {
  const params = new URLSearchParams({
    model: 'nova-3',
    language,
    encoding: 'linear16',
    sample_rate: String(TARGET_SAMPLE_RATE),
    channels: '1',
    interim_results: 'true',
    smart_format: 'true',
    punctuate: 'true',
    endpointing: '300',
    utterance_end_ms: '1000',
    vad_events: 'true',
  })
  // Nova-3 的 keyterm prompting：提高專有名詞（例如 seq2seq）的辨識率
  for (const k of keyterms) params.append('keyterm', k)
  return `${DEEPGRAM_LISTEN_URL}?${params}`
}

interface DeepgramResults {
  type: 'Results'
  is_final?: boolean
  speech_final?: boolean
  channel?: { alternatives?: { transcript?: string }[] }
}

export function parseDeepgramMessage(msg: unknown): TranscriptEvent[] {
  if (!msg || typeof msg !== 'object') return []
  const m = msg as { type?: string }

  if (m.type === 'UtteranceEnd') return [{ type: 'endOfTurn' }]
  if (m.type !== 'Results') return []

  const r = m as DeepgramResults
  const text = (r.channel?.alternatives?.[0]?.transcript ?? '').trim()

  if (!r.is_final) return text ? [{ type: 'partial', text }] : []
  if (text) return [{ type: 'final', text, endOfTurn: Boolean(r.speech_final) }]
  // 空的 final：清掉殘留的 partial；若同時是 speech_final 就收尾
  return r.speech_final ? [{ type: 'partial', text: '' }, { type: 'endOfTurn' }] : [{ type: 'partial', text: '' }]
}

export function createDeepgramEngine(opts: EngineOptions): WsEngine {
  return new WsEngine(
    {
      url: buildDeepgramUrl(opts.language, opts.keyterms),
      // 瀏覽器無法設定 WebSocket header，Deepgram 用 subprotocol 傳短效 JWT
      protocols: ['bearer', opts.token],
      parse: parseDeepgramMessage,
      closeMessage: JSON.stringify({ type: 'CloseStream' }),
      keepAlive: { message: JSON.stringify({ type: 'KeepAlive' }), intervalMs: 5000 },
    },
    opts.handlers,
  )
}
