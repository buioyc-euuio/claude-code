import { timingSafeEqual } from 'node:crypto'

/**
 * 簡單的通關碼保護：設定 APP_PASSCODE 後，API 只接受帶正確 x-passcode 的請求。
 * 目的是避免部署在公開網址時被別人拿去花你的 API 額度。
 */
export function checkPasscode(req: Request): Response | null {
  const expected = process.env.APP_PASSCODE
  if (!expected) return null

  const given = req.headers.get('x-passcode') ?? ''
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  if (a.length === b.length && timingSafeEqual(a, b)) return null

  return Response.json({ error: '通關碼錯誤' }, { status: 401 })
}

export function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status })
}
