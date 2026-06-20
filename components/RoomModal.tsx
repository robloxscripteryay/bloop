'use client'

import { useState } from 'react'
import type { Profile } from '@/lib/types'

export default function RoomModal({
  onClose,
  onCreate,
  searchUsers,
}: {
  onClose: () => void
  onCreate: (name: string, memberIds: string[]) => void
  searchUsers: (query: string) => Promise<Profile[]>
}) {
  const [name, setName] = useState('')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Profile[]>([])
  const [selected, setSelected] = useState<Profile[]>([])

  async function handleSearch(q: string) {
    setQuery(q)
    if (!q.trim()) {
      setResults([])
      return
    }
    const data = await searchUsers(q)
    setResults(data.filter((u) => !selected.find((s) => s.id === u.id)))
  }

  function toggleSelect(u: Profile) {
    setSelected((prev) =>
      prev.find((s) => s.id === u.id) ? prev.filter((s) => s.id !== u.id) : [...prev, u]
    )
    setResults((prev) => prev.filter((r) => r.id !== u.id))
  }

  return (
    <div className="modal-overlay show" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Start a group room</h3>
        <p className="sub">Search for people to add, like a Discord server but lightweight.</p>

        <div className="field">
          <label htmlFor="room-name-input">Room name</label>
          <input
            id="room-name-input"
            type="text"
            placeholder="e.g. weekend plans"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="room-member-search">Add members</label>
          <input
            id="room-member-search"
            type="text"
            placeholder="Search by username..."
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
          />
          <div className="member-picker">
            {selected.length === 0 && results.length === 0 && (
              <div className="empty-hint">Search for people to add by username.</div>
            )}
            {selected.map((u) => (
              <div key={u.id} className="pick-chip selected" onClick={() => toggleSelect(u)}>
                <div className="mini-avatar" style={{ background: u.avatar_color }}>
                  {u.username.slice(0, 2).toUpperCase()}
                </div>
                {u.username}
              </div>
            ))}
            {results.map((u) => (
              <div key={u.id} className="pick-chip" onClick={() => toggleSelect(u)}>
                <div className="mini-avatar" style={{ background: u.avatar_color }}>
                  {u.username.slice(0, 2).toUpperCase()}
                </div>
                {u.username}
              </div>
            ))}
          </div>
        </div>

        <div className="modal-actions">
          <button className="secondary-btn" onClick={onClose}>Cancel</button>
          <button
            className="primary-btn"
            disabled={!name.trim()}
            onClick={() => onCreate(name.trim(), selected.map((s) => s.id))}
          >
            Create room
          </button>
        </div>
      </div>
    </div>
  )
}
