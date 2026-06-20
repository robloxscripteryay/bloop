'use client'

import { useState, useRef, useCallback } from 'react'

export function useToast() {
  const [toast, setToast] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setToast(null), 2600)
  }, [])

  return { toast, showToast }
}

export default function Toast({ message }: { message: string | null }) {
  return (
    <div id="toast" className={message ? 'show' : ''}>
      <div className="dot" />
      <span>{message}</span>
    </div>
  )
}
