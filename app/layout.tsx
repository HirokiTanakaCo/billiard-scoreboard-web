import type { ReactNode } from 'react'
import HeightProvider from './HeightProvider'

export const metadata = {
  title: 'Billiard Room',
  description: 'Scoreboard system',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body
        style={{
          height: 'calc(var(--vh) * 100)',
          margin: 0,
          padding: 0,
          background: '#000',
          overflowY: 'auto',
        }}
      >
        <HeightProvider />
        {children}
      </body>
    </html>
  )
}
