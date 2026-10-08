import { describe, expect, test } from 'bun:test'
import type { TranscriptEvent } from '../engines/types'
import {
  applyEvent,
  contextBefore,
  flush,
  initialTranscript,
  toMarkdown,
  updateLine,
  type Line,
  type TranscriptState,
} from '../transcript'

function run(events: TranscriptEvent[], start: TranscriptState = initialTranscript) {
  let state = start
  const closed: Line[] = []
  for (const e of events) {
    const r = applyEvent(state, e)
    state = r.state
    closed.push(...r.closed)
  }
  return { state, closed }
}

describe('applyEvent', () => {
  test('partial only updates the in-progress text', () => {
    const { state, closed } = run([{ type: 'partial', text: 'hello' }])
    expect(state.partial).toBe('hello')
    expect(state.lines).toEqual([])
    expect(closed).toEqual([])
  })

  test('finals accumulate into one open line until endOfTurn', () => {
    const { state, closed } = run([
      { type: 'partial', text: 'today we' },
      { type: 'final', text: 'Today we present', endOfTurn: false },
      { type: 'final', text: 'a seq2seq model.', endOfTurn: false },
    ])
    expect(state.partial).toBe('')
    expect(state.lines).toHaveLength(1)
    expect(state.lines[0]).toMatchObject({ en: 'Today we present a seq2seq model.', status: 'open' })
    expect(closed).toEqual([])
  })

  test('final with endOfTurn closes the line and reports it', () => {
    const { state, closed } = run([
      { type: 'final', text: 'First part', endOfTurn: false },
      { type: 'final', text: 'second part.', endOfTurn: true },
      { type: 'final', text: 'Next sentence', endOfTurn: false },
    ])
    expect(closed).toHaveLength(1)
    expect(closed[0]).toMatchObject({ id: 1, en: 'First part second part.', status: 'closed' })
    expect(state.lines.map((l) => l.status)).toEqual(['closed', 'open'])
    expect(state.lines[1].id).toBe(2)
  })

  test('standalone endOfTurn closes the open line, and is a no-op otherwise', () => {
    const { state, closed } = run([
      { type: 'final', text: 'Hello.', endOfTurn: false },
      { type: 'endOfTurn' },
      { type: 'endOfTurn' },
    ])
    expect(closed).toHaveLength(1)
    expect(state.lines).toHaveLength(1)
  })

  test('long monologue is force-closed at a sentence end', () => {
    const long = `${'word '.repeat(50).trim()}.`
    const { closed } = run([{ type: 'final', text: long, endOfTurn: false }])
    expect(closed).toHaveLength(1)
  })

  test('long text without punctuation is not force-closed until the hard limit', () => {
    const { closed } = run([{ type: 'final', text: 'word '.repeat(50).trim(), endOfTurn: false }])
    expect(closed).toHaveLength(0)
    const { closed: hard } = run([{ type: 'final', text: 'word '.repeat(90).trim(), endOfTurn: false }])
    expect(hard).toHaveLength(1)
  })
})

describe('flush', () => {
  test('turns the pending partial into a closed line', () => {
    const { state } = run([
      { type: 'final', text: 'We trained it', endOfTurn: false },
      { type: 'partial', text: 'on eating data' },
    ])
    const r = flush(state)
    expect(r.state.partial).toBe('')
    expect(r.closed).toHaveLength(1)
    expect(r.closed[0].en).toBe('We trained it on eating data')
  })

  test('does nothing on an empty transcript', () => {
    const r = flush(initialTranscript)
    expect(r.closed).toEqual([])
    expect(r.state.lines).toEqual([])
  })
})

describe('helpers', () => {
  const { state } = run([
    { type: 'final', text: 'One.', endOfTurn: true },
    { type: 'final', text: 'Two.', endOfTurn: true },
    { type: 'final', text: 'Three.', endOfTurn: true },
    { type: 'final', text: 'Four.', endOfTurn: true },
    { type: 'final', text: 'Five.', endOfTurn: true },
  ])

  test('contextBefore returns up to n previous lines', () => {
    expect(contextBefore(state, 5)).toEqual(['Two.', 'Three.', 'Four.'])
    expect(contextBefore(state, 1)).toEqual([])
    expect(contextBefore(state, 99)).toEqual([])
  })

  test('updateLine patches only the target line', () => {
    const next = updateLine(state, 2, { zh: '二。', status: 'done' })
    expect(next.lines[1]).toMatchObject({ zh: '二。', status: 'done' })
    expect(next.lines[0].zh).toBe('')
  })

  test('toMarkdown includes translations as quotes', () => {
    const md = toMarkdown(updateLine(state, 1, { zh: '一。' }), 'T')
    expect(md.startsWith('# T\n\nOne.\n\n> 一。\n\nTwo.')).toBe(true)
  })
})
