'use client'

import { useEffect, useState } from 'react'
import type { Room } from '@/lib/types'

export default function CallModal({
  room,
  kind,
  onClose,
}: {
  room: Room
  kind: 'voice' | 'video'
  onClose: () => void
}) {
  const [status, setStatus] = useState('Calling…')
  const [muted, setMuted] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => {
      setStatus('No real-time audio/video is wired up yet — this is a UI placeholder.')
    }, 1400)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className="modal-overlay call-modal show" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="call-avatar">{room.icon}</div>
        <h3>{room.name}</h3>
        <div className="call-status">{kind === 'video' ? 'Video call — ' : ''}{status}</div>
        <div className="call-actions">
          <button className="call-btn mute" onClick={() => setMuted((m) => !m)} title="Mute">
            {muted ? '🔇' : '🎙️'}
          </button>
          <button className="call-btn end" onClick={onClose} title="End call">✕</button>
        </div>
      </div>
    </div>
  )
}
