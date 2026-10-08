import { TARGET_SAMPLE_RATE } from '../audio/pcm'
import type { EngineOptions, TranscriptEvent } from './types'
import { WsEngine } from './ws-engine'

const ASSEMBLYAI_WS_URL = 'wss://streaming.assemblyai.com/v3/ws'

export function buildAssemblyAiUrl(token: string): string {
  const params = new URLSearchParams({
    sample_rate: String(TARGET_SAMPLE_RATE),
    encoding: 'pcm_s16le',
    format_turns: 'true',
    token,
  })
  return `${ASSEMBLYAI_WS_URL}?${params}`
}

interface AssemblyAiTurn {
  type: 'Turn'
  transcript?: string
  end_of_turn?: boolean
  turn_is_formatted?: boolean
}

/**
 * AssemblyAI 的 Turn.transcript 是「這一輪到目前為止的完整文字」。
 * format_turns=true 時，一輪結束會先來一則未格式化的 end_of_turn，
 * 再來一則 turn_is_formatted=true 的最終版本，以後者為準。
 */
export function parseAssemblyAiMessage(msg: unknown): TranscriptEvent[] {
  if (!msg || typeof msg !== 'object') return []
  const m = msg as { type?: string }
  if (m.type !== 'Turn') return []

  const t = m as AssemblyAiTurn
  const text = (t.transcript ?? '').trim()

  if (t.end_of_turn && t.turn_is_formatted) {
    return text ? [{ type: 'final', text, endOfTurn: true }] : [{ type: 'partial', text: '' }, { type: 'endOfTurn' }]
  }
  return [{ type: 'partial', text }]
}

export function createAssemblyAiEngine(opts: EngineOptions): WsEngine {
  return new WsEngine(
    {
      url: buildAssemblyAiUrl(opts.token),
      parse: parseAssemblyAiMessage,
      closeMessage: JSON.stringify({ type: 'Terminate' }),
    },
    opts.handlers,
  )
}
