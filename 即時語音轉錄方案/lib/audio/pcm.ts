/**
 * 純函式的音訊處理：降頻、float32 → PCM16、切成固定長度的 chunk。
 * 不依賴瀏覽器 API，可以直接用 bun test 測。
 */

export const TARGET_SAMPLE_RATE = 16000

/**
 * 有狀態的降頻器（box filter 平均）。
 * 支援非整數倍率（例如 44.1k → 16k），跨 chunk 保留殘餘樣本，避免接縫處失真。
 */
export class Resampler {
  private readonly ratio: number
  private leftover: Float32Array = new Float32Array(0)
  private pos = 0

  constructor(
    readonly inRate: number,
    readonly outRate: number = TARGET_SAMPLE_RATE,
  ) {
    if (inRate < outRate) {
      throw new Error(`不支援升頻：${inRate} → ${outRate}`)
    }
    this.ratio = inRate / outRate
  }

  process(input: Float32Array): Float32Array {
    const buf = new Float32Array(this.leftover.length + input.length)
    buf.set(this.leftover, 0)
    buf.set(input, this.leftover.length)

    const out: number[] = []
    while (this.pos + this.ratio <= buf.length) {
      const start = Math.floor(this.pos)
      const end = Math.min(buf.length, Math.ceil(this.pos + this.ratio))
      let sum = 0
      for (let i = start; i < end; i++) sum += buf[i]
      out.push(sum / (end - start))
      this.pos += this.ratio
    }

    const consumed = Math.floor(this.pos)
    this.leftover = buf.slice(consumed)
    this.pos -= consumed
    return Float32Array.from(out)
  }
}

export function floatToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

/**
 * 把任意長度的 PCM16 累積成固定長度的 chunk。
 * AssemblyAI 要求每包 50–1000ms，預設 100ms（16kHz 下 1600 個樣本）。
 */
export class Int16Chunker {
  private buf: Int16Array
  private len = 0

  constructor(readonly chunkSamples: number = TARGET_SAMPLE_RATE / 10) {
    this.buf = new Int16Array(chunkSamples)
  }

  push(input: Int16Array): Int16Array[] {
    const chunks: Int16Array[] = []
    let offset = 0
    while (offset < input.length) {
      const n = Math.min(this.chunkSamples - this.len, input.length - offset)
      this.buf.set(input.subarray(offset, offset + n), this.len)
      this.len += n
      offset += n
      if (this.len === this.chunkSamples) {
        chunks.push(this.buf)
        this.buf = new Int16Array(this.chunkSamples)
        this.len = 0
      }
    }
    return chunks
  }
}

/** 0–1 的音量（RMS），給 UI 的音量條用 */
export function rmsLevel(input: Float32Array): number {
  if (input.length === 0) return 0
  let sum = 0
  for (let i = 0; i < input.length; i++) sum += input[i] * input[i]
  return Math.min(1, Math.sqrt(sum / input.length) * 4)
}
