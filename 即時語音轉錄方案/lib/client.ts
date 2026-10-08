import { createAssemblyAiEngine } from './engines/assemblyai'
import { createDeepgramEngine } from './engines/deepgram'
import type { Engine, EngineOptions, ProviderId } from './engines/types'

/** 瀏覽器端呼叫自家 API 的小工具 */

function headers(passcode: string): HeadersInit {
  return { 'Content-Type': 'application/json', ...(passcode ? { 'x-passcode': passcode } : {}) }
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string }
    if (data.error) return data.error
  } catch {
    // 不是 JSON
  }
  return `HTTP ${res.status}`
}

export async function fetchSttToken(provider: ProviderId, passcode: string): Promise<string> {
  const res = await fetch('/api/stt-token', {
    method: 'POST',
    headers: headers(passcode),
    body: JSON.stringify({ provider }),
  })
  if (!res.ok) throw new Error(await errorMessage(res))
  return ((await res.json()) as { token: string }).token
}

/** 串流翻譯：每收到一段文字就呼叫 onText（累積後的全文） */
export async function translateStream(
  text: string,
  context: string[],
  passcode: string,
  onText: (full: string) => void,
): Promise<string> {
  const res = await fetch('/api/translate', {
    method: 'POST',
    headers: headers(passcode),
    body: JSON.stringify({ text, context }),
  })
  if (!res.ok || !res.body) throw new Error(await errorMessage(res))

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let full = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    full += decoder.decode(value, { stream: true })
    onText(full)
  }
  full += decoder.decode()
  onText(full)
  return full
}

export function createEngine(provider: ProviderId, opts: EngineOptions): Engine {
  switch (provider) {
    case 'deepgram':
      return createDeepgramEngine(opts)
    case 'assemblyai':
      return createAssemblyAiEngine(opts)
  }
}
