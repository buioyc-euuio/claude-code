'use client'

import type { Line } from '@/lib/transcript'
import type { ViewMode } from '@/lib/settings'

interface Props {
  lines: Line[]
  partial: string
  view: ViewMode
  fontSize: number
  translate: boolean
  /** 浮動視窗只顯示最後幾行 */
  compact?: boolean
}

function zhText(line: Line): string {
  if (line.zh) return line.zh
  if (line.status === 'translating' || line.status === 'closed') return '…'
  if (line.status === 'error') return '〔翻譯失敗〕'
  return ''
}

export function Captions({ lines, partial, view, fontSize, translate, compact }: Props) {
  const shown = compact ? lines.slice(-2) : lines
  // 沒開翻譯時，「只有中文」也退回顯示英文
  const showZh = translate && view !== 'en'
  const showEn = view !== 'zh' || !showZh

  return (
    <div className={compact ? 'captions captions-compact' : 'captions'} style={{ fontSize }}>
      {shown.map((line) => (
        <div key={line.id} className="caption-line">
          {showEn && <p className={showZh ? 'en en-sub' : 'en'}>{line.en}</p>}
          {showZh && line.status !== 'open' && <p className="zh">{zhText(line)}</p>}
        </div>
      ))}
      {partial && (
        <div className="caption-line">
          <p className="en partial">{partial}</p>
        </div>
      )}
      {lines.length === 0 && !partial && <p className="placeholder">字幕會顯示在這裡</p>}
    </div>
  )
}
