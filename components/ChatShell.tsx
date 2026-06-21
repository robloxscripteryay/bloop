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

  // ---------- Fix: iPad/iOS keyboard pushes the whole page up ----------
  // Root cause: Safari doesn't shrink the CSS layout viewport when the
  // on-screen keyboard opens — only the *visual* viewport shrinks. Since our
  // layout is sized with vh/dvh (the layout viewport), the browser scrolls
  // the page to keep the focused input visible above the keyboard, which
  // drags the whole app shell upward instead of just resizing the chat.
  //
  // IMPORTANT: window.visualViewport.height is known to be unreliable on
  // first read on iOS (it can report an incorrect, too-small value before
  // the page has fully settled — see WICG/visual-viewport#78). Blindly
  // applying it on mount previously shrank the entire app to a sliver.
  // To stay safe, we only ever apply it as an override once we've observed
  // at least one resize/scroll event AFTER mount (a real signal something
  // changed, e.g. keyboard opening), and we never let it shrink the app
  // below a sane floor (480px) so a bad reading can't blank the screen.
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!vv) return // unsupported browsers: CSS dvh fallback in globals.css still applies

    let hasSeenRealResize = false

    function applyViewportHeight() {
      if (!hasSeenRealResize) return // ignore the unreliable first/initial reading
      const h = vv!.height
      if (!h || h < 480) return // implausible reading — never let this blank the app
      document.documentElement.style.setProperty('--app-height', `${h}px`)
      window.scrollTo(0, 0)
    }

    function onResize() {
      hasSeenRealResize = true
      applyViewportHeight()
    }

    vv.addEventListener('resize', onResize)
    vv.addEventListener('scroll', onResize)
    return () => {
      vv.removeEventListener('resize', onResize)
      vv.removeEventListener('scroll', onResize)
      document.documentElement.style.removeProperty('--app-height')
    }
  }, [])

  // ---------- Safety net: force mobile layout via JS, independent of CSS @media ----------
  // This duplicates what @media (max-width:860px) should already do in
  // globals.css, but as a direct, unconditional override based on actual
  // measured window width. If the CSS media query ever fails to apply for
  // any reason, this still guarantees the sidebar collapses and the main
  // content area gets the full window width instead of being squeezed into
  // a sliver by the 76px+260px fixed-width grid columns.
  const [isMobileWidth, setIsMobileWidth] = useState(false)
  useEffect(() => {
    function checkWidth() {
      setIsMobileWidth(window.innerWidth <= 860)
    }
    checkWidth()
    window.addEventListener('resize', checkWidth)
    return () => window.removeEventListener('resize', checkWidth)
  }, [])

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
  const [groupMenuOpen, setGroupMenuOpen] = useState(false)
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
          const incomingId = (payload.new as Message).id

          // Fetch the author profile for display (realtime payload only has author_id)
          const { data: author } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', payload.new.author_id)
            .maybeSingle()

          // Skip if we already have this exact message — e.g. it was just
          // added optimistically by sendMessage and already replaced with
          // the real row, so this realtime echo would otherwise render it twice.
          setMessages((prev) => {
            if (prev.some((m) => m.id === incomingId)) return prev
            return [...prev, { ...(payload.new as Message), author: author ?? undefined }]
          })
        }
      )
      .on(
        // Messages auto-delete after 5 minutes (server-side cron job). Without
        // this, a message removed on the server would keep showing on screen
        // for anyone already viewing the room until they refreshed.
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'messages', filter: `room_id=eq.${currentRoomId}` },
        (payload) => {
          setMessages((prev) => prev.filter((m) => m.id !== payload.old.id))
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
        const allEntries = Object.values(state).flat() as any[]
        // Dedupe by user id: the same account open in two tabs/devices tracks
        // two separate presence entries under the same key, which previously
        // showed that person twice in the online list (and showed "you"
        // twice if you had the app open on more than one device).
        const seen = new Set<string>()
        const members: Profile[] = []
        for (const entry of allEntries) {
          const p = entry.profile as Profile
          if (p && !seen.has(p.id)) {
            seen.add(p.id)
            members.push(p)
          }
        }
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

    // Optimistic update: show the message immediately instead of waiting on
    // the realtime echo, which can be delayed, drop, or arrive after a room
    // switch — that gap was the cause of "I sent a message but it shows no
    // messages." We use a temporary client-side id so we can later match
    // and replace it with the real row from the server (or from realtime)
    // without rendering it twice.
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const optimisticMessage: Message = {
      id: tempId,
      room_id: currentRoomId,
      author_id: profile.id,
      text,
      media_url: null,
      media_type: null,
      created_at: new Date().toISOString(),
      author: profile,
    }
    setMessages((prev) => [...prev, optimisticMessage])

    const { data: inserted, error } = await supabase
      .from('messages')
      .insert({ room_id: currentRoomId, author_id: profile.id, text })
      .select('*, author:profiles(*)')
      .single()

    if (error) {
      showToast('⚠️ Message failed to send — check your connection')
      // Roll back the optimistic message so the UI doesn't lie about what sent.
      setMessages((prev) => prev.filter((m) => m.id !== tempId))
      return
    }

    // Replace the temp message with the real saved row (real id, exact
    // server timestamp). If the realtime INSERT event for this same row
    // also arrives, the INSERT handler below skips it (already present by id).
    setMessages((prev) => prev.map((m) => (m.id === tempId ? (inserted as any) : m)))
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

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const optimisticMessage: Message = {
      id: tempId,
      room_id: currentRoomId,
      author_id: profile.id,
      text: null,
      media_url: urlData.publicUrl,
      media_type: isVideo ? 'video' : 'image',
      created_at: new Date().toISOString(),
      author: profile,
    }
    setMessages((prev) => [...prev, optimisticMessage])

    const { data: inserted, error: insertError } = await supabase
      .from('messages')
      .insert({
        room_id: currentRoomId,
        author_id: profile.id,
        media_url: urlData.publicUrl,
        media_type: isVideo ? 'video' : 'image',
      })
      .select('*, author:profiles(*)')
      .single()

    if (insertError) {
      showToast('⚠️ Could not post media: ' + insertError.message)
      setMessages((prev) => prev.filter((m) => m.id !== tempId))
    } else {
      showToast('✅ Sent!')
      setMessages((prev) => prev.map((m) => (m.id === tempId ? (inserted as any) : m)))
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

  // Only the creator can fully delete a group (removes it for everyone).
  // Enforced both here (UI) and in the database (RLS policy), so this can't
  // be bypassed even by calling the API directly.
  async function deleteGroup(room: RoomWithPreview) {
    if (!profile || room.created_by !== profile.id) return
    const confirmed = window.confirm(`Delete "${room.name}" for everyone? This can't be undone.`)
    if (!confirmed) return

    const { error } = await supabase.from('rooms').delete().eq('id', room.id)
    if (error) {
      showToast('⚠️ Could not delete group')
      return
    }
    showToast(`🗑️ Deleted "${room.name}"`)
    setMyRooms((prev) => prev.filter((r) => r.id !== room.id))
    if (currentRoomId === room.id && globalRoomId) {
      openRoom(globalRoomId, { id: globalRoomId, type: 'global', name: 'Global Chat', icon: '🌐', created_by: null, created_at: '' })
      setView('global')
    }
  }

  // Anyone (including the creator) can leave a group — this only removes
  // their own membership, not the group itself, for non-creators.
  async function leaveGroup(room: RoomWithPreview) {
    if (!profile) return
    const confirmed = window.confirm(`Leave "${room.name}"? You'll need to be re-invited to rejoin.`)
    if (!confirmed) return

    const { error } = await supabase
      .from('room_members')
      .delete()
      .eq('room_id', room.id)
      .eq('user_id', profile.id)
    if (error) {
      showToast('⚠️ Could not leave group')
      return
    }
    showToast(`👋 Left "${room.name}"`)
    setMyRooms((prev) => prev.filter((r) => r.id !== room.id))
    if (currentRoomId === room.id && globalRoomId) {
      openRoom(globalRoomId, { id: globalRoomId, type: 'global', name: 'Global Chat', icon: '🌐', created_by: null, created_at: '' })
      setView('global')
    }
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
    <div
      className={`app-shell ${sidebarOpen ? 'sidebar-open' : ''}`}
      data-theme={profile?.theme ?? 'coral'}
      style={isMobileWidth ? { gridTemplateColumns: '0 0 minmax(0, 1fr)' } : undefined}
    >
      <div
        className="mobile-overlay"
        onClick={() => setSidebarOpen(false)}
        style={isMobileWidth ? { display: sidebarOpen ? 'block' : 'none', position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 55 } : undefined}
      />

      {/* RAIL */}
      <div className="rail" style={isMobileWidth ? { display: 'none' } : undefined}>
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
      <div
        className="sidebar"
        style={
          isMobileWidth
            ? {
                position: 'fixed',
                left: 0,
                top: 0,
                bottom: 0,
                width: '260px',
                zIndex: 60,
                transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
                transition: 'transform .35s cubic-bezier(.22,1,.36,1)',
                boxShadow: '0 0 40px rgba(0,0,0,.5)',
              }
            : undefined
        }
      >
        <div className="sidebar-header">
          <h2>{view === 'global' ? 'Global Chat' : 'Messages'}</h2>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', position: 'relative' }}>
            <button
              className="icon-btn mobile-account-btn"
              style={isMobileWidth ? { display: 'flex' } : undefined}
              onClick={() => (isGuest ? promptSignup() : setThemePopoverOpen((v) => !v))}
              title="Account settings"
            >
              {isGuest ? 'G' : (profile?.username?.slice(0, 2).toUpperCase() ?? '··')}
            </button>
            {themePopoverOpen && !isGuest && (
              <div
                className="theme-popover show"
                style={{
                  position: 'fixed',
                  top: '60px',
                  right: '14px',
                  left: 'auto',
                  bottom: 'auto',
                  zIndex: 999,
                }}
              >
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
            <button className="icon-btn menu-toggle" style={isMobileWidth ? { display: 'flex' } : undefined} onClick={() => setSidebarOpen(false)}>✕</button>
          </div>
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
            <button className="icon-btn menu-toggle" style={isMobileWidth ? { display: 'flex' } : undefined} onClick={() => setSidebarOpen(true)}>☰</button>
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
          {currentRoom?.type === 'group' && (
            <div style={{ position: 'relative' }}>
              <button className="icon-btn" title="Group options" onClick={() => setGroupMenuOpen((v) => !v)}>⋮</button>
              {groupMenuOpen && (
                <div className="theme-popover show" style={{ left: 'auto', right: 0, bottom: 'auto', top: 'calc(100% + 8px)', width: 180 }}>
                  {currentRoom.created_by === profile.id ? (
                    <button
                      className="signout-btn"
                      style={{ marginTop: 0 }}
                      onClick={() => { setGroupMenuOpen(false); deleteGroup(currentRoom) }}
                    >
                      Delete group
                    </button>
                  ) : (
                    <button
                      className="signout-btn"
                      style={{ marginTop: 0 }}
                      onClick={() => { setGroupMenuOpen(false); leaveGroup(currentRoom) }}
                    >
                      Leave group
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
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
