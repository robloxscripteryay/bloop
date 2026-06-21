import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Bloop',
  description: 'Chat, share, and hang out — free, for everyone.',
}

// CRITICAL: without this, mobile browsers assume the page was built for
// desktop and render it at a virtual ~980px-wide viewport, then shrink the
// whole page to fit the physical screen. That produces exactly what was
// reported: identical broken layout on every phone/browser, no different
// in forced "Desktop site" mode, and none of the @media (max-width:...)
// rules in globals.css ever matching, since the browser never reports a
// narrow viewport width to begin with.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
