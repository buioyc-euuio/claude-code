import type { TranscriptEvent } from './engines/types'

/**
 * 字幕狀態（純函式，方便測試）。
 * 一個 Line = 一句（或一段）英文；收尾（closed）後才送去翻譯。
 */

export type LineStatus = 'open' | 'closed' | 'translating' | 'done' | 'error'

export interface Line {
  id: number
  en: string
  zh: string
  status: LineStatus
}

export interface TranscriptState {
  lines: Line[]
  /** 還沒確定的半句，只顯示、不翻譯 */
  partial: string
  nextId: number
}

export const initialTranscript: TranscriptState = { lines: [], partial: '', nextId: 1 }

/** 講者一直沒停頓時，超過這個長度、遇到句尾標點就強制斷行 */
const SOFT_MAX_CHARS = 220
/** 無論如何都斷行的長度 */
const HARD_MAX_CHARS = 420

function shouldForceClose(en: string): boolean {
  if (en.length >= HARD_MAX_CHARS) return true
  return en.length >= SOFT_MAX_CHARS && /[.?!]["')\]]?$/.test(en)
}

function openLine(state: TranscriptState): Line | undefined {
  const last = state.lines[state.lines.length - 1]
  return last?.status === 'open' ? last : undefined
}

function replaceLast(lines: Line[], line: Line): Line[] {
  return [...lines.slice(0, -1), line]
}

/** 收尾目前開著的那一行；回傳新 state 與「剛收尾、需要翻譯」的行 */
function closeOpen(state: TranscriptState): { state: TranscriptState; closed: Line[] } {
  const line = openLine(state)
  if (!line) return { state, closed: [] }
  if (!line.en.trim()) {
    return { state: { ...state, lines: state.lines.slice(0, -1) }, closed: [] }
  }
  const closedLine: Line = { ...line, status: 'closed' }
  return { state: { ...state, lines: replaceLast(state.lines, closedLine) }, closed: [closedLine] }
}

export function applyEvent(
  state: TranscriptState,
  event: TranscriptEvent,
): { state: TranscriptState; closed: Line[] } {
  switch (event.type) {
    case 'partial':
      return { state: { ...state, partial: event.text }, closed: [] }

    case 'final': {
      const existing = openLine(state)
      let next: TranscriptState
      if (existing) {
        const en = existing.en ? `${existing.en} ${event.text}` : event.text
        next = { ...state, partial: '', lines: replaceLast(state.lines, { ...existing, en }) }
      } else {
        const line: Line = { id: state.nextId, en: event.text, zh: '', status: 'open' }
        next = { ...state, partial: '', nextId: state.nextId + 1, lines: [...state.lines, line] }
      }
      const current = openLine(next)
      if (event.endOfTurn || (current && shouldForceClose(current.en))) return closeOpen(next)
      return { state: next, closed: [] }
    }

    case 'endOfTurn':
      return closeOpen(state)
  }
}

/** 停止錄音時把剩下的半句也收進來 */
export function flush(state: TranscriptState): { state: TranscriptState; closed: Line[] } {
  let next = state
  if (state.partial.trim()) {
    next = applyEvent(state, { type: 'final', text: state.partial.trim(), endOfTurn: false }).state
  }
  return closeOpen({ ...next, partial: '' })
}

export function updateLine(state: TranscriptState, id: number, patch: Partial<Omit<Line, 'id'>>): TranscriptState {
  return { ...state, lines: state.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }
}

/** 翻譯時附上的前文（最多 n 句英文） */
export function contextBefore(state: TranscriptState, id: number, n = 3): string[] {
  const idx = state.lines.findIndex((l) => l.id === id)
  if (idx <= 0) return []
  return state.lines.slice(Math.max(0, idx - n), idx).map((l) => l.en)
}

export function toMarkdown(state: TranscriptState, title = '逐字稿'): string {
  const body = state.lines
    .filter((l) => l.en.trim())
    .map((l) => (l.zh ? `${l.en}\n\n> ${l.zh}` : l.en))
    .join('\n\n')
  return `# ${title}\n\n${body}\n`
}
