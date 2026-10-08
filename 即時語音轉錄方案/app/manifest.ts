import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '即時字幕',
    short_name: '即時字幕',
    description: '英文演講即時轉錄與中文翻譯',
    start_url: '/',
    display: 'standalone',
    background_color: '#14213d',
    theme_color: '#14213d',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  }
}
