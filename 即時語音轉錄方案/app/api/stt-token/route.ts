import { checkPasscode, jsonError } from '@/lib/server/auth'

/**
 * 發給瀏覽器的短效 token。真正的 API key 只存在伺服器的環境變數裡。
 * 瀏覽器拿到 token 後直接用 WebSocket 連 STT 服務，音訊不經過 Vercel。
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TOKEN_TTL_SECONDS = 60

async function deepgramToken(apiKey: string): Promise<string> {
  const res = await fetch('https://api.deepgram.com/v1/auth/grant', {
    method: 'POST',
    headers: { Authorization: `Token ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl_seconds: TOKEN_TTL_SECONDS }),
  })
  if (!res.ok) throw new Error(`Deepgram 回應 ${res.status}：${await res.text()}`)
  const data = (await res.json()) as { access_token?: string }
  if (!data.access_token) throw new Error('Deepgram 沒有回傳 access_token')
  return data.access_token
}

async function assemblyAiToken(apiKey: string): Promise<string> {
  const url = `https://streaming.assemblyai.com/v3/token?expires_in_seconds=${TOKEN_TTL_SECONDS}`
  const res = await fetch(url, { headers: { Authorization: apiKey } })
  if (!res.ok) throw new Error(`AssemblyAI 回應 ${res.status}：${await res.text()}`)
  const data = (await res.json()) as { token?: string }
  if (!data.token) throw new Error('AssemblyAI 沒有回傳 token')
  return data.token
}

export async function POST(req: Request) {
  const denied = checkPasscode(req)
  if (denied) return denied

  let provider: unknown
  try {
    provider = ((await req.json()) as { provider?: unknown }).provider
  } catch {
    return jsonError('請求格式錯誤', 400)
  }

  try {
    if (provider === 'deepgram') {
      const key = process.env.DEEPGRAM_API_KEY
      if (!key) return jsonError('伺服器沒有設定 DEEPGRAM_API_KEY', 500)
      return Response.json({ token: await deepgramToken(key) })
    }
    if (provider === 'assemblyai') {
      const key = process.env.ASSEMBLYAI_API_KEY
      if (!key) return jsonError('伺服器沒有設定 ASSEMBLYAI_API_KEY', 500)
      return Response.json({ token: await assemblyAiToken(key) })
    }
    return jsonError('不支援的 provider', 400)
  } catch (err) {
    console.error('[stt-token]', err)
    return jsonError('取得 STT token 失敗，請檢查 API key', 502)
  }
}
