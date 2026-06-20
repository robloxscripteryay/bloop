'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-client'
import type { Profile, Room, Message } from '@/lib/types'
import RoomModal from './RoomModal'
import Toast, { useToast } from './Toast'

type RoomWithPreview = Room & { lastMessage?: string; otherUser?: Profile; status?: string }

export default function ChatShell({ initialProfile, isGuest }: { initialProfile: Profile; isGuest: boolean }) {
  const router = useRouter()
  const supabase = createClient()
  const { toast, showToast } = useToast()

  const [profile, setProfile] = useState<Profile>(initialProfile)

  const [view, setView] = useState<'global' | 'dms'>('global')
  const [globalRoomId, setGlobalRoomId] = useState<string | null>(null)
  const [myRooms, setMyRooms] = useState<RoomWithPreview[]>([])
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(null)
  const [currentRoom, setCurrentRoom] = useState<RoomWithPreview | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [onlineMembers, setOnlineMembers] = useState<Profile[]>([])

  const [composerText, setComposerText] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [themePopoverOpen, setThemePopoverOpen] = useState(false)
  const [roomModalOpen, setRoomModalOpen] = useState(false)
  const [memberSearch, setMemberSearch] = useState('')
  const [dmSearch, setDmSearch] = useState('')
  const [searchResults, setSearchResults] = useState<Profile[]>([])

  const fileInputRef = useRef<HTMLInputElement>(null)

  // ---------- Load the Global room id, then its messages ----------
  useEffect(() => {
    let cancelled = false

    async function loadGlobal() {
      const { data, error } = await supabase
        .from('rooms')
        .select('*')
        .eq('type', 'global')
        .limit(1)
        .single()
      if (cancelled) return
      if (error) {
        showToast('⚠️ Could not load Global Chat — refresh to try again')
        return
      }
      setGlobalRoomId(data.id)
      setCurrentRoomId(data.id)
      setCurrentRoom({ ...data, name: 'Global Chat', icon: '🌐' })
    }
    loadGlobal()
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Load my rooms/DMs (account holders only) ----------
  const loadMyRooms = useCallback(async () => {
    if (isGuest || !profile) return
    const { data: memberships, error } = await supabase
      .from('room_members')
      .select('room_id, rooms(*)')
      .eq('user_id', profile.id)

    if (error || !memberships) return

    const rooms = memberships
      .map((m: any) => m.rooms)
      .filter((r: Room | null) => r && r.type !== 'global') as Room[]

    // For DMs, resolve the other person's profile for display name/avatar.
    const withPreviews: RoomWithPreview[] = await Promise.all(
      rooms.map(async (r) => {
        if (r.type === 'dm') {
          const { data: members } = await supabase
            .from('room_members')
            .select('user_id, profiles(*)')
            .eq('room_id', r.id)
            .neq('user_id', profile.id)
            .limit(1)
          const other = (members?.[0] as any)?.profiles as Profile | undefined
          return { ...r, otherUser: other, name: other?.username ?? 'Unknown user', status: other?.status }
        }
        return r
      })
    )

    setMyRooms(withPreviews)
  }, [isGuest, profile, supabase])

  useEffect(() => {
    loadMyRooms()
  }, [loadMyRooms])

  // ---------- Load messages for whichever room is open ----------
  useEffect(() => {
    if (!currentRoomId) return
    let cancelled = false
    setMessagesLoading(true)

    async function loadMessages() {
      const { data, error } = await supabase
        .from('messages')
        .select('*, author:profiles(*)')
        .eq('room_id', currentRoomId)
        .order('created_at', { ascending: true })
        .limit(200)

      if (cancelled) return
      setMessagesLoading(false)
      if (error) {
        showToast('⚠️ Could not load messages')
        return
      }
      setMessages((data as any) ?? [])
    }
    loadMessages()
    return () => { cancelled = true }
  }, [currentRoomId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Realtime: subscribe to new messages in the current room ----------
  useEffect(() => {
    if (!currentRoomId) return

    const channel = supabase
      .channel(`room-${currentRoomId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${currentRoomId}` },
        async (payload) => {
          // Fetch the author profile for display (realtime payload only has author_id)
          const { data: author } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', payload.new.author_id)
            .maybeSingle()
          setMessages((prev) => [...prev, { ...(payload.new as Message), author: author ?? undefined }])
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [currentRoomId, supabase])

  // ---------- Realtime: track who's online in Global (presence) ----------
  useEffect(() => {
    if (!globalRoomId || isGuest || !profile) return

    const presenceChannel = supabase.channel('global-presence', {
      config: { presence: { key: profile.id } },
    })

    presenceChannel
      .on('presence', { event: 'sync' }, () => {
        const state = presenceChannel.presenceState()
        const members = Object.values(state)
          .flat()
          .map((p: any) => p.profile as Profile)
        setOnlineMembers(members)
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await presenceChannel.track({ profile })
        }
      })

    return () => { supabase.removeChannel(presenceChannel) }
  }, [globalRoomId, isGuest, profile, supabase])

  // ---------- Auto-scroll to newest message ----------
  // Scoped to the messages container itself (messagesContainerRef), not
  // scrollIntoView, which walks up the DOM to find "the nearest scrollable
  // ancestor" and can end up scrolling the whole page if any ancestor's
  // height isn't perfectly constrained — which is what caused the page to
  // jump on send instead of just scrolling the message list.
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const container = messagesContainerRef.current
    if (container) {
      container.scrollTop = container.scrollHeight
    }
  }, [messages])

  // ---------- Actions ----------
  function promptSignup() {
    showToast('🔒 Create a free account to unlock that')
  }

  function setRailView(v: 'global' | 'dms') {
    if (v === 'dms' && isGuest) {
      promptSignup()
      return
    }
    setView(v)
    if (v === 'global' && globalRoomId) {
      openRoom(globalRoomId, { id: globalRoomId, type: 'global', name: 'Global Chat', icon: '🌐', created_by: null, created_at: '' })
    } else if (v === 'dms') {
      if (myRooms.length > 0) {
        openRoom(myRooms[0].id, myRooms[0])
      } else {
        setCurrentRoomId(null)
        setCurrentRoom(null)
        setMessages([])
      }
    }
  }

  function openRoom(id: string, room: RoomWithPreview) {
    setCurrentRoomId(id)
    setCurrentRoom(room)
    setSidebarOpen(false)
  }

  async function sendMessage() {
    const text = composerText.trim()
    if (!text || !currentRoomId) return

    if (isGuest && view === 'dms') {
      promptSignup()
      return
    }

    setComposerText('')

    const { error } = await supabase.from('messages').insert({
      room_id: currentRoomId,
      author_id: profile.id,
      text,
    })
    if (error) {
      showToast('⚠️ Message failed to send — check your connection')
    }
    // No optimistic local push needed — the realtime INSERT subscription above
    // will deliver it back to us (and everyone else) within a moment.
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !profile || !currentRoomId) return

    const isVideo = file.type.startsWith('video/')
    const isImage = file.type.startsWith('image/')
    if (!isVideo && !isImage) {
      showToast('⚠️ Only images and videos are supported')
      return
    }

    showToast('📤 Uploading...')
    const path = `${profile.id}/${Date.now()}-${file.name}`
    const { error: uploadError } = await supabase.storage.from('chat-media').upload(path, file)
    if (uploadError) {
      showToast('⚠️ Upload failed: ' + uploadError.message)
      return
    }
    const { data: urlData } = supabase.storage.from('chat-media').getPublicUrl(path)

    const { error: insertError } = await supabase.from('messages').insert({
      room_id: currentRoomId,
      author_id: profile.id,
      media_url: urlData.publicUrl,
      media_type: isVideo ? 'video' : 'image',
    })
    if (insertError) {
      showToast('⚠️ Could not post media: ' + insertError.message)
    } else {
      showToast('✅ Sent!')
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function searchUsers(query: string) {
    setDmSearch(query)
    if (!query.trim() || !profile) {
      setSearchResults([])
      return
    }
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .ilike('username', `%${query.trim()}%`)
      .neq('id', profile.id)
      .limit(8)
    setSearchResults(data ?? [])
  }

  async function startDm(otherUser: Profile) {
    if (!profile) return
    setSearchResults([])
    setDmSearch('')

    // Look for an existing DM between these two users first.
    const { data: myDmRooms } = await supabase
      .from('room_members')
      .select('room_id, rooms!inner(type)')
      .eq('user_id', profile.id)
      .eq('rooms.type', 'dm')

    for (const r of myDmRooms ?? []) {
      const { data: members } = await supabase
        .from('room_members')
        .select('user_id')
        .eq('room_id', (r as any).room_id)
      const ids = (members ?? []).map((m) => m.user_id)
      if (ids.includes(otherUser.id) && ids.length === 2) {
        await loadMyRooms()
        openRoom((r as any).room_id, { id: (r as any).room_id, type: 'dm', name: otherUser.username, icon: '💬', created_by: null, created_at: '', otherUser })
        setView('dms')
        return
      }
    }

    // No existing DM — create one.
    const { data: newRoom, error: roomError } = await supabase
      .from('rooms')
      .insert({ type: 'dm', created_by: profile.id, icon: '💬' })
      .select()
      .single()
    if (roomError || !newRoom) {
      showToast('⚠️ Could not start DM')
      return
    }
    await supabase.from('room_members').insert([
      { room_id: newRoom.id, user_id: profile.id },
      { room_id: newRoom.id, user_id: otherUser.id },
    ])
    await loadMyRooms()
    setView('dms')
    openRoom(newRoom.id, { ...newRoom, name: otherUser.username, otherUser })
    showToast(`💬 Started a DM with ${otherUser.username}`)
  }

  async function createRoom(name: string, memberIds: string[]) {
    if (!profile) return
    const { data: newRoom, error } = await supabase
      .from('rooms')
      .insert({ type: 'group', name, icon: '💬', created_by: profile.id })
      .select()
      .single()
    if (error || !newRoom) {
      showToast('⚠️ Could not create room')
      return
    }
    const members = [profile.id, ...memberIds].map((uid) => ({ room_id: newRoom.id, user_id: uid }))
    await supabase.from('room_members').insert(members)
    await loadMyRooms()
    setRoomModalOpen(false)
    showToast(`✅ Created room "${name}"`)
    openRoom(newRoom.id, newRoom)
  }

  async function setTheme(theme: string) {
    if (!profile) return
    document.body.setAttribute('data-theme', theme)
    await supabase.from('profiles').update({ theme }).eq('id', profile.id)
    setProfile({ ...profile, theme })
    showToast(`🎨 Theme set to ${theme.charAt(0).toUpperCase() + theme.slice(1)}`)
  }

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  function leaveGuestMode() {
    // Sign the anonymous session out and send them to create a real account.
    supabase.auth.signOut().then(() => router.push('/login'))
  }

  // ---------- Render ----------
  return (
    <div className={`app-shell ${sidebarOpen ? 'sidebar-open' : ''}`} data-theme={profile?.theme ?? 'coral'}>
      <div className="mobile-overlay" onClick={() => setSidebarOpen(false)} />

      {/* RAIL */}
      <div className="rail">
        <div className="rail-logo">B</div>
        <div
          className={`rail-item ${view === 'global' ? 'active' : ''}`}
          onClick={() => setRailView('global')}
          title="Global Chat"
        >
          <div className="indicator" />🌐
        </div>
        <div
          className={`rail-item ${view === 'dms' ? 'active' : ''} ${isGuest ? 'disabled' : ''}`}
          onClick={() => setRailView('dms')}
          title="Direct Messages"
        >
          <div className="indicator" />💬
        </div>
        <div className="rail-bottom" style={{ position: 'relative' }}>
          <div className="rail-avatar" onClick={() => (isGuest ? promptSignup() : setThemePopoverOpen((v) => !v))} title="Account settings">
            {isGuest ? 'G' : (profile?.username?.slice(0, 2).toUpperCase() ?? '··')}
          </div>
          {themePopoverOpen && !isGuest && (
            <div className="theme-popover show">
              <h4>Chat theme</h4>
              <div className="theme-grid">
                {(['coral', 'teal', 'violet', 'amber'] as const).map((t) => (
                  <div
                    key={t}
                    className={`theme-swatch sw-${t} ${profile?.theme === t ? 'selected' : ''}`}
                    onClick={() => setTheme(t)}
                  />
                ))}
              </div>
              <button className="signout-btn" onClick={signOut}>Sign out</button>
            </div>
          )}
        </div>
      </div>

      {/* SIDEBAR */}
      <div className="sidebar">
        <div className="sidebar-header">
          <h2>{view === 'global' ? 'Global Chat' : 'Messages'}</h2>
          <button className="icon-btn menu-toggle" onClick={() => setSidebarOpen(false)}>✕</button>
        </div>

        {view === 'global' ? (
          <div className="sidebar-panel">
            <div className="search-bar">
              <SearchIcon />
              <input
                type="text"
                placeholder="Search members..."
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
              />
            </div>
            <div className="list-scroll">
              {onlineMembers.filter((m) => m.username.toLowerCase().includes(memberSearch.toLowerCase())).length === 0 ? (
                <div className="empty-state">
                  <div className="icon">🌐</div>
                  <div className="title">It&apos;s quiet in here</div>
                  <div className="sub">
                    {isGuest
                      ? "You're the only one here right now."
                      : "You're the only one here right now. Members will show up here as people join Global Chat."}
                  </div>
                </div>
              ) : (
                onlineMembers
                  .filter((m) => m.username.toLowerCase().includes(memberSearch.toLowerCase()))
                  .map((m) => (
                    <button key={m.id} className="chat-item" onClick={() => (isGuest ? promptSignup() : startDm(m))}>
                      <div className="avatar" style={{ background: m.avatar_color }}>
                        {m.username.slice(0, 2).toUpperCase()}
                        <span className="status-dot online" />
                      </div>
                      <div className="chat-item-text">
                        <div className="name">{m.username}</div>
                        <div className="preview">online</div>
                      </div>
                    </button>
                  ))
              )}
            </div>
          </div>
        ) : (
          <div className="sidebar-panel">
            <div className="search-bar">
              <SearchIcon />
              <input
                type="text"
                placeholder="Search people to DM..."
                value={dmSearch}
                onChange={(e) => searchUsers(e.target.value)}
              />
            </div>
            <button className="new-dm-btn" onClick={() => setRoomModalOpen(true)}>
              + Start a group room
            </button>
            <div className="list-scroll">
              {dmSearch.trim() ? (
                searchResults.length === 0 ? (
                  <div className="empty-state">
                    <div className="icon">🔍</div>
                    <div className="sub">No accounts found matching &quot;{dmSearch}&quot;</div>
                  </div>
                ) : (
                  <>
                    <div className="section-label">Results</div>
                    {searchResults.map((u) => (
                      <button key={u.id} className="chat-item" onClick={() => (isGuest ? promptSignup() : startDm(u))}>
                        <div className="avatar" style={{ background: u.avatar_color }}>
                          {u.username.slice(0, 2).toUpperCase()}
                          <span className={`status-dot ${u.status}`} />
                        </div>
                        <div className="chat-item-text">
                          <div className="name">{u.username}</div>
                          <div className="preview">{u.status}</div>
                        </div>
                      </button>
                    ))}
                  </>
                )
              ) : myRooms.length === 0 ? (
                <div className="empty-state">
                  <div className="icon">✉️</div>
                  <div className="title">No messages yet</div>
                  <div className="sub">Search for someone above to start a DM, or create a group room.</div>
                </div>
              ) : (
                myRooms.map((r) => (
                  <button
                    key={r.id}
                    className={`chat-item ${currentRoomId === r.id ? 'active' : ''}`}
                    onClick={() => openRoom(r.id, r)}
                  >
                    <div className={`avatar ${r.type === 'group' ? 'room' : ''}`} style={{ background: r.otherUser?.avatar_color }}>
                      {r.type === 'group' ? r.icon : r.name?.slice(0, 2).toUpperCase()}
                      {r.type === 'dm' && <span className={`status-dot ${r.status ?? 'offline'}`} />}
                    </div>
                    <div className="chat-item-text">
                      <div className="name">{r.name}</div>
                      <div className="preview">{r.lastMessage ?? 'No messages yet'}</div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {isGuest && (
          <div className="guest-banner">
            You&apos;re browsing as a <b onClick={leaveGuestMode}>Guest</b>. <b onClick={leaveGuestMode}>Create a free account</b> to DM people and join rooms.
          </div>
        )}
      </div>

      {/* MAIN */}
      <div className="main">
        <div className="chat-header">
          <div className="chat-header-left">
            <button className="icon-btn menu-toggle" onClick={() => setSidebarOpen(true)}>☰</button>
            <div className="avatar room" style={{ width: 34, height: 34, fontSize: 13 }}>
              {currentRoom?.icon ?? '💬'}
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="title">{currentRoom?.name ?? 'No chat selected'}</div>
              <div className="subtitle">
                {currentRoom?.type === 'global' ? 'Open to everyone on Bloop' : currentRoom?.type === 'dm' ? 'Direct message' : currentRoom ? 'Group room' : ''}
              </div>
            </div>
          </div>
        </div>

        <div className="messages" ref={messagesContainerRef}>
          {messagesLoading ? (
            <div className="messages-empty"><span className="spinner" style={{ borderTopColor: 'var(--accent)', borderColor: 'var(--border)' }} /></div>
          ) : !currentRoom ? (
            <div className="messages-empty">
              <div className="icon">💬</div>
              <div className="title">No conversations yet</div>
              <div className="sub">Start a DM by searching for someone, or create a group room to get things going.</div>
            </div>
          ) : messages.length === 0 ? (
            <div className="messages-empty">
              <div className="icon">🫧</div>
              <div className="title">No messages yet</div>
              <div className="sub">Be the first to say something here.</div>
            </div>
          ) : (
            <>
              {messages.map((m, idx) => {
                const grouped = idx > 0 && messages[idx - 1].author_id === m.author_id
                return (
                  <div key={m.id} className={`msg-row ${grouped ? 'grouped' : ''}`}>
                    {grouped ? (
                      <div className="avatar-spacer" />
                    ) : (
                      <div className="avatar" style={{ background: m.author?.avatar_color }}>
                        {m.author?.username?.slice(0, 2).toUpperCase() ?? '?'}
                      </div>
                    )}
                    <div className="msg-body">
                      {!grouped && (
                        <div className="msg-meta">
                          <span className="author">{m.author?.username ?? 'Deleted user'}</span>
                          <span className="time">{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      )}
                      {m.text && <div className="msg-text">{m.text}</div>}
                      {m.media_url && m.media_type === 'image' && (
                        <div className="msg-media"><img src={m.media_url} alt="shared image" loading="lazy" /></div>
                      )}
                      {m.media_url && m.media_type === 'video' && (
                        <div className="msg-media"><video src={m.media_url} controls /></div>
                      )}
                    </div>
                  </div>
                )
              })}
            </>
          )}
        </div>

        <div className="composer">
          <input ref={fileInputRef} type="file" accept="image/*,video/*" style={{ display: 'none' }} onChange={handleFileSelected} />
          <button
            className="attach-btn"
            disabled={!currentRoom || isGuest}
            onClick={() => (isGuest ? promptSignup() : fileInputRef.current?.click())}
          >
            📎
          </button>
          <div className="composer-inner">
            <input
              type="text"
              placeholder={currentRoom ? `Message ${currentRoom.name}...` : 'Select a conversation first...'}
              value={composerText}
              disabled={!currentRoom}
              onChange={(e) => setComposerText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') sendMessage() }}
            />
          </div>
          <button className="send-btn" disabled={!currentRoom} onClick={sendMessage}>➤</button>
        </div>
      </div>

      {/* MEMBER PANEL */}
      <div className={`member-panel ${view === 'global' ? 'show' : ''}`}>
        <h3>{onlineMembers.length > 0 ? `Online — ${onlineMembers.length}` : 'Members'}</h3>
        {onlineMembers.length === 0 ? (
          <div className="empty-state"><div className="sub">No one else is online right now.</div></div>
        ) : (
          onlineMembers.map((m) => (
            <div className="member-row" key={m.id}>
              <div className="avatar" style={{ width: 30, height: 30, fontSize: 11, background: m.avatar_color }}>
                {m.username.slice(0, 2).toUpperCase()}
              </div>
              <div className="mname">{m.username}</div>
            </div>
          ))
        )}
      </div>

      {roomModalOpen && (
        <RoomModal
          onClose={() => setRoomModalOpen(false)}
          onCreate={createRoom}
          searchUsers={async (q: string) => {
            if (!profile) return []
            const { data } = await supabase.from('profiles').select('*').ilike('username', `%${q}%`).neq('id', profile.id).limit(8)
            return data ?? []
          }}
        />
      )}

      <Toast message={toast} />
    </div>
  )
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  )
}
