// AudioWorklet：只負責把麥克風 / 分頁音訊的 float32 樣本攢成較大的區塊再送回主執行緒。
// 降頻與轉 PCM16 在主執行緒做（lib/audio/pcm.ts，有單元測試）。
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    // 約 43ms（48kHz 下），每秒只送 ~23 則訊息
    this.size = 2048
    this.buf = new Float32Array(this.size)
    this.len = 0
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true

    // 多聲道混成單聲道
    const channels = input.length
    const frames = input[0].length
    for (let i = 0; i < frames; i++) {
      let s = 0
      for (let c = 0; c < channels; c++) s += input[c][i]
      this.buf[this.len++] = s / channels
      if (this.len === this.size) {
        this.port.postMessage(this.buf, [this.buf.buffer])
        this.buf = new Float32Array(this.size)
        this.len = 0
      }
    }
    return true
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor)
