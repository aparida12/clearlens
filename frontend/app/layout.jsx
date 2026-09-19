import { ClerkProvider } from '@clerk/nextjs'
import './globals.css'
import './clearlens.css'

export const metadata = {
  title: 'Public Health Research',
  description: 'Unbiased public health journalism powered by evidence.',
}

export default function RootLayout({ children }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body suppressHydrationWarning>{children}</body>
      </html>
    </ClerkProvider>
  )
}
