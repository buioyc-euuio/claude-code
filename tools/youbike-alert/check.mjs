#!/usr/bin/env node
// YouBike 2.0 站點車輛提醒（新竹・陽明交大三站）
// 條件：每天 17:00–18:20（Asia/Taipei），三站合計可借 < 10 台，或逐風廣場（女二舍）< 7 台 → 推播
// 依賴：Node 18+（內建 fetch），無第三方套件

const API_URLS = (process.env.YB_API_URLS ||
  'https://apis.youbike.com.tw/json/station-yb2.json,https://apis.youbike.com.tw/api/front/station/all?lang=tw&type=2'
).split(',')

const STATIONS = [
  { key: '大學路', match: '陽明交通大學(大學路)' },
  { key: '研三舍', match: '陽明交通大學(研三舍)' },
  { key: '逐風廣場(女二舍)', match: '陽明交通大學(逐風廣場)', single: true },
]

const TOTAL_THRESHOLD = Number(process.env.TOTAL_THRESHOLD ?? 10) // 合計「小於」此數就提醒
const SINGLE_THRESHOLD = Number(process.env.SINGLE_THRESHOLD ?? 7) // 女二舍「小於」此數就提醒
const WINDOW_START = process.env.WINDOW_START ?? '17:00'
const WINDOW_END = process.env.WINDOW_END ?? '18:20'
const FORCE = process.env.FORCE === 'true' // 手動測試：忽略時間窗並一定推播

const norm = s =>
  String(s ?? '')
    .replace(/^YouBike2\.0_/i, '')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/\s+/g, '')

const num = v => (v === undefined || v === null || v === '' ? undefined : Number(v))

// 兼容不同 API schema
function parseStation(r) {
  const name = r.name_tw ?? r.sna ?? r.name ?? ''
  const d = r.available_spaces_detail ?? {}
  let normal = num(d.yb2) ?? num(r.yb2_quantity) ?? num(r.available_spaces_yb2)
  let electric = num(d.eyb) ?? num(r.eyb_quantity) ?? num(r.available_spaces_eyb) ?? 0
  const total = num(r.available_spaces) ?? num(r.sbi_quantity) ?? num(r.sbi) ?? num(r.available_rent_bikes)
  if (normal === undefined) normal = (total ?? 0) - electric
  return {
    name,
    normal,
    electric,
    total: normal + electric,
    empty: num(r.empty_spaces) ?? num(r.bemp),
    updatedAt: r.updated_at ?? r.mday ?? r.srcUpdateTime ?? '',
  }
}

async function loadRecords() {
  if (process.env.YB_DATA_FILE) {
    const fs = await import('node:fs/promises')
    return toArray(JSON.parse(await fs.readFile(process.env.YB_DATA_FILE, 'utf8')))
  }
  const errors = []
  for (const url of API_URLS) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 youbike-alert', Accept: 'application/json' },
        signal: AbortSignal.timeout(20000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const arr = toArray(await res.json())
      if (arr.length) return arr
      throw new Error('empty payload')
    } catch (e) {
      errors.push(`${url}: ${e.message}`)
    }
  }
  throw new Error(`所有 API 都失敗：\n${errors.join('\n')}`)
}

function toArray(j) {
  if (Array.isArray(j)) return j
  for (const k of ['retVal', 'data', 'result']) {
    const v = j?.[k]
    if (Array.isArray(v)) return v
    if (v && typeof v === 'object') {
      const inner = toArray(v)
      if (inner.length) return inner
      return Object.values(v)
    }
  }
  return []
}

function taipeiNow() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date())
  const h = parts.find(p => p.type === 'hour').value
  const m = parts.find(p => p.type === 'minute').value
  return `${h === '24' ? '00' : h}:${m}`
}

async function notify(title, body, urgent) {
  const sent = []
  if (process.env.NTFY_TOPIC) {
    const server = process.env.NTFY_SERVER || 'https://ntfy.sh'
    const res = await fetch(`${server}/${encodeURIComponent(process.env.NTFY_TOPIC)}`, {
      method: 'POST',
      headers: {
        // HTTP header 只能放 ASCII，中文標題用 RFC 2047 編碼
        Title: `=?UTF-8?B?${Buffer.from(title).toString('base64')}?=`,
        Priority: urgent ? 'high' : 'default',
        Tags: 'bike',
      },
      body,
    })
    sent.push(`ntfy ${res.status}`)
  }
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: `${title}\n\n${body}` }),
    })
    sent.push(`telegram ${res.status}`)
  }
  console.log(sent.length ? `已推播：${sent.join(', ')}` : '⚠️ 沒有設定 NTFY_TOPIC / TELEGRAM_*，只印在 log')
}

async function main() {
  const now = taipeiNow()
  if (!FORCE && (now < WINDOW_START || now > WINDOW_END)) {
    console.log(`現在 ${now}（台北），不在 ${WINDOW_START}–${WINDOW_END}，略過`)
    return
  }

  const records = (await loadRecords()).map(parseStation)
  const rows = STATIONS.map(s => {
    const hit = records.find(r => norm(r.name) === norm(s.match)) ??
      records.find(r => norm(r.name).includes(norm(s.match)))
    if (!hit) {
      const near = records.filter(r => norm(r.name).includes('陽明交通')).map(r => r.name)
      throw new Error(`找不到站點「${s.match}」。相近站名：${near.join('、') || '（無）'}`)
    }
    return { ...s, ...hit }
  })

  const total = rows.reduce((a, r) => a + r.total, 0)
  const single = rows.find(r => r.single)
  const reasons = []
  if (total < TOTAL_THRESHOLD) reasons.push(`三站合計只剩 ${total} 台（< ${TOTAL_THRESHOLD}）`)
  if (single.total < SINGLE_THRESHOLD) reasons.push(`${single.key}只剩 ${single.total} 台（< ${SINGLE_THRESHOLD}）`)

  const lines = rows.map(r => `• ${r.key}：一般 ${r.normal}／電輔 ${r.electric}（共 ${r.total}）`)
  const body = [
    ...(reasons.length ? reasons.map(x => `⚠️ ${x}`) : ['（測試推播，未達提醒條件）']),
    '',
    ...lines,
    `合計：${total} 台`,
    '',
    `台北時間 ${now}・資料更新 ${rows[0].updatedAt}`,
  ].join('\n')

  console.log(body)
  if (reasons.length || FORCE) {
    await notify(reasons.length ? '🚲 YouBike 快沒車了！' : '🚲 YouBike 測試', body, reasons.length > 0)
  } else {
    console.log('車量充足，不推播')
  }
}

main().catch(e => {
  console.error(e.message)
  process.exit(1)
})
