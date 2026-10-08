import Anthropic from '@anthropic-ai/sdk'
import { checkPasscode, jsonError } from '@/lib/server/auth'

/**
 * 把一句英文逐字稿翻成繁體中文，以純文字串流回傳。
 * 模型可用 TRANSLATE_MODEL 覆寫；effort 用 low 以壓低延遲。
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const DEFAULT_MODEL = 'claude-opus-5-5'
/** 支援伺服器端 refusal fallback 的模型 */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-fable-5-1'])

const SYSTEM_PROMPT = `你是學術研討會的即時口譯員，負責把英文演講的語音辨識逐字稿翻成台灣慣用的繁體中文。

規則：
- 只輸出這一句的譯文，不要加引號、註解或原文。
- 語音辨識可能有錯字或斷句不完整，依上下文推測原意後翻譯。
- 機器學習與工程領域的專有名詞（例如 seq2seq、ground truth、encoder），台灣研究圈習慣直接講英文的就保留英文。
- 口語贅詞（um、you know）省略，語氣保持自然口語。
- 前文只是理解用的參考，不要翻譯前文。`

let client: Anthropic | null = null
/** 延遲建立：避免 build 時沒有 API key 就在載入模組時失敗 */
function getClient(): Anthropic {
  client ??= new Anthropic()
  return client
}

interface TranslateBody {
  text?: unknown
  context?: unknown
}

function parseBody(body: TranslateBody): { text: string; context: string[] } | null {
  if (typeof body.text !== 'string') return null
  const text = body.text.trim().slice(0, 2000)
  if (!text) return null
  const context = Array.isArray(body.context)
    ? body.context.filter((c): c is string => typeof c === 'string').slice(-5).map((c) => c.slice(0, 1000))
    : []
  return { text, context }
}

function buildUserMessage(text: string, context: string[]): string {
  const ctx = context.length ? `前文（僅供參考）：\n${context.join('\n')}\n\n` : ''
  return `${ctx}請翻譯這一句：\n${text}`
}

export async function POST(req: Request) {
  const denied = checkPasscode(req)
  if (denied) return denied

  let parsed: ReturnType<typeof parseBody>
  try {
    parsed = parseBody((await req.json()) as TranslateBody)
  } catch {
    parsed = null
  }
  if (!parsed) return jsonError('請求格式錯誤', 400)
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return jsonError('伺服器沒有設定 ANTHROPIC_API_KEY', 500)
  }

  const model = process.env.TRANSLATE_MODEL || DEFAULT_MODEL
  const useFallback = FALLBACK_MODELS.has(model)

  const stream = getClient().beta.messages.stream({
    model,
    max_tokens: 4000,
    output_config: { effort: 'low' },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserMessage(parsed.text, parsed.context) }],
    ...(useFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
  })

  // 先等 HTTP 連線建立，讓 401 / 429 這類錯誤能回傳正確的狀態碼
  try {
    await stream.withResponse()
  } catch (err) {
    return translateError(err)
  }

  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let wroteText = false
      try {
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            wroteText = true
            controller.enqueue(encoder.encode(event.delta.text))
          }
        }
        const final = await stream.finalMessage()
        if (final.stop_reason === 'refusal' && !wroteText) {
          controller.enqueue(encoder.encode('〔這句無法翻譯〕'))
        }
      } catch (err) {
        console.error('[translate] stream error', err)
        if (!wroteText) controller.enqueue(encoder.encode('〔翻譯失敗〕'))
      } finally {
        controller.close()
      }
    },
    cancel() {
      stream.abort()
    },
  })

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

function translateError(err: unknown): Response {
  console.error('[translate]', err)
  if (err instanceof Anthropic.AuthenticationError) return jsonError('ANTHROPIC_API_KEY 無效', 500)
  if (err instanceof Anthropic.RateLimitError) return jsonError('翻譯請求太頻繁，稍後再試', 429)
  if (err instanceof Anthropic.BadRequestError) return jsonError(`翻譯請求被拒絕：${err.message}`, 400)
  if (err instanceof Anthropic.APIError) return jsonError(`翻譯服務錯誤（${err.status}）`, 502)
  return jsonError('無法連線到翻譯服務', 502)
}
