import { describe, expect, test } from 'bun:test'
import { buildAssemblyAiUrl, parseAssemblyAiMessage } from '../engines/assemblyai'
import { buildDeepgramUrl, parseDeepgramMessage } from '../engines/deepgram'

function dg(transcript: string, is_final: boolean, speech_final = false) {
  return { type: 'Results', is_final, speech_final, channel: { alternatives: [{ transcript }] } }
}

describe('parseDeepgramMessage', () => {
  test('interim result → partial', () => {
    expect(parseDeepgramMessage(dg('hello wor', false))).toEqual([{ type: 'partial', text: 'hello wor' }])
  })

  test('final segment without speech_final keeps the turn open', () => {
    expect(parseDeepgramMessage(dg('Hello world.', true))).toEqual([
      { type: 'final', text: 'Hello world.', endOfTurn: false },
    ])
  })

  test('speech_final ends the turn', () => {
    expect(parseDeepgramMessage(dg('Thanks.', true, true))).toEqual([
      { type: 'final', text: 'Thanks.', endOfTurn: true },
    ])
  })

  test('empty final clears the partial; empty speech_final also ends the turn', () => {
    expect(parseDeepgramMessage(dg('', true))).toEqual([{ type: 'partial', text: '' }])
    expect(parseDeepgramMessage(dg('', true, true))).toEqual([{ type: 'partial', text: '' }, { type: 'endOfTurn' }])
  })

  test('UtteranceEnd → endOfTurn; other messages ignored', () => {
    expect(parseDeepgramMessage({ type: 'UtteranceEnd', last_word_end: 3.1 })).toEqual([{ type: 'endOfTurn' }])
    expect(parseDeepgramMessage({ type: 'Metadata' })).toEqual([])
    expect(parseDeepgramMessage({ type: 'SpeechStarted' })).toEqual([])
    expect(parseDeepgramMessage(null)).toEqual([])
  })
})

describe('buildDeepgramUrl', () => {
  test('includes audio format and repeated keyterms', () => {
    const url = new URL(buildDeepgramUrl('en', ['seq2seq', 'ground truth']))
    expect(url.origin + url.pathname).toBe('wss://api.deepgram.com/v1/listen')
    expect(url.searchParams.get('model')).toBe('nova-3')
    expect(url.searchParams.get('encoding')).toBe('linear16')
    expect(url.searchParams.get('sample_rate')).toBe('16000')
    expect(url.searchParams.get('interim_results')).toBe('true')
    expect(url.searchParams.getAll('keyterm')).toEqual(['seq2seq', 'ground truth'])
  })
})

describe('parseAssemblyAiMessage', () => {
  test('in-progress turn → partial with the whole turn so far', () => {
    expect(
      parseAssemblyAiMessage({ type: 'Turn', transcript: 'so the model', end_of_turn: false, turn_is_formatted: false }),
    ).toEqual([{ type: 'partial', text: 'so the model' }])
  })

  test('unformatted end_of_turn waits for the formatted version', () => {
    expect(
      parseAssemblyAiMessage({ type: 'Turn', transcript: 'so the model works', end_of_turn: true, turn_is_formatted: false }),
    ).toEqual([{ type: 'partial', text: 'so the model works' }])
  })

  test('formatted end_of_turn → final', () => {
    expect(
      parseAssemblyAiMessage({ type: 'Turn', transcript: 'So the model works.', end_of_turn: true, turn_is_formatted: true }),
    ).toEqual([{ type: 'final', text: 'So the model works.', endOfTurn: true }])
  })

  test('Begin / Termination are ignored', () => {
    expect(parseAssemblyAiMessage({ type: 'Begin', id: 'x' })).toEqual([])
    expect(parseAssemblyAiMessage({ type: 'Termination' })).toEqual([])
  })
})

describe('buildAssemblyAiUrl', () => {
  test('passes the temporary token as a query parameter', () => {
    const url = new URL(buildAssemblyAiUrl('tok123'))
    expect(url.origin + url.pathname).toBe('wss://streaming.assemblyai.com/v3/ws')
    expect(url.searchParams.get('token')).toBe('tok123')
    expect(url.searchParams.get('sample_rate')).toBe('16000')
    expect(url.searchParams.get('format_turns')).toBe('true')
  })
})
