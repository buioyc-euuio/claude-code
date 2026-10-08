import { describe, expect, test } from 'bun:test'
import { floatToInt16, Int16Chunker, Resampler, rmsLevel } from '../audio/pcm'

describe('Resampler', () => {
  test('48k → 16k produces one third of the samples', () => {
    const r = new Resampler(48000)
    const out = r.process(new Float32Array(4800).fill(0.5))
    expect(out.length).toBe(1600)
    expect(out[0]).toBeCloseTo(0.5)
  })

  test('keeps leftover samples across chunks', () => {
    const r = new Resampler(48000)
    let total = 0
    for (let i = 0; i < 10; i++) total += r.process(new Float32Array(1000)).length
    // 10000 / 3 = 3333.33…
    expect(total).toBe(3333)
  })

  test('handles non-integer ratio (44.1k)', () => {
    const r = new Resampler(44100)
    let total = 0
    for (let i = 0; i < 44; i++) total += r.process(new Float32Array(1000)).length
    // 44000 samples at 44.1k ≈ 15963 at 16k
    expect(Math.abs(total - 15963)).toBeLessThanOrEqual(1)
  })

  test('averages samples (box filter)', () => {
    const r = new Resampler(48000)
    const out = r.process(Float32Array.from([0, 0.3, 0.6, 1, 1, 1]))
    expect(out[0]).toBeCloseTo(0.3)
    expect(out[1]).toBeCloseTo(1)
  })

  test('passes through at equal rates', () => {
    const r = new Resampler(16000)
    const input = Float32Array.from([0.1, -0.2, 0.3])
    expect(Array.from(r.process(input))).toEqual(Array.from(input))
  })

  test('rejects upsampling', () => {
    expect(() => new Resampler(8000)).toThrow()
  })
})

describe('floatToInt16', () => {
  test('maps and clamps the range', () => {
    expect(Array.from(floatToInt16(Float32Array.from([0, 1, -1, 2, -2])))).toEqual([0, 32767, -32768, 32767, -32768])
  })
})

describe('Int16Chunker', () => {
  test('emits fixed-size chunks and keeps the remainder', () => {
    const c = new Int16Chunker(4)
    expect(c.push(Int16Array.from([1, 2, 3]))).toEqual([])
    const chunks = c.push(Int16Array.from([4, 5, 6, 7, 8, 9]))
    expect(chunks.map((x) => Array.from(x))).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
    ])
    expect(c.push(Int16Array.from([10, 11, 12])).map((x) => Array.from(x))).toEqual([[9, 10, 11, 12]])
  })

  test('chunks are independent copies', () => {
    const c = new Int16Chunker(2)
    const [a, b] = c.push(Int16Array.from([1, 2, 3, 4]))
    expect(a).not.toBe(b)
    expect(Array.from(a)).toEqual([1, 2])
  })
})

describe('rmsLevel', () => {
  test('is 0 for silence and capped at 1', () => {
    expect(rmsLevel(new Float32Array(10))).toBe(0)
    expect(rmsLevel(new Float32Array(10).fill(1))).toBe(1)
  })
})
