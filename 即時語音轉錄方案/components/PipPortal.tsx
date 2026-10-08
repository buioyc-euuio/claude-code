'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Document Picture-in-Picture（Chrome 116+）：永遠置頂的小視窗，可以蓋在 Meet 上面 */
interface DocumentPictureInPicture {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>
}

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture
  }
}

export function pipSupported(): boolean {
  return typeof window !== 'undefined' && 'documentPictureInPicture' in window
}

function copyStyles(target: Document) {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const style = target.createElement('style')
      style.textContent = Array.from(sheet.cssRules)
        .map((r) => r.cssText)
        .join('\n')
      target.head.appendChild(style)
    } catch {
      // 跨網域的 stylesheet 讀不到 cssRules，改用 <link>
      if (sheet.href) {
        const link = target.createElement('link')
        link.rel = 'stylesheet'
        link.href = sheet.href
        target.head.appendChild(link)
      }
    }
  }
}

export async function openPipWindow(): Promise<Window> {
  const pip = window.documentPictureInPicture
  if (!pip) throw new Error('這個瀏覽器不支援浮動字幕視窗（需要桌面版 Chrome / Edge 116 以上）')
  const win = await pip.requestWindow({ width: 720, height: 220 })
  copyStyles(win.document)
  win.document.body.classList.add('pip-body')
  return win
}

export function PipPortal({ win, children }: { win: Window; children: ReactNode }) {
  const [container, setContainer] = useState<HTMLElement | null>(null)

  useEffect(() => {
    const el = win.document.createElement('div')
    el.className = 'pip-root'
    win.document.body.appendChild(el)
    setContainer(el)
    return () => {
      el.remove()
    }
  }, [win])

  return container ? createPortal(children, container) : null
}
