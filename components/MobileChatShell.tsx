'use client'

import { useRef } from 'react'
import type { Profile, Room, Message } from '@/lib/types'

type RoomWithPreview = Room & { lastMessage?: string; otherUser?: Profile; status?: string }

// All state and actions are owned by ChatShell and passed in as props.
// This component only handles phone-specific rendering — no CSS Grid, no
// position:fixed overlays, no z-index stacking. Just one full-screen panel
// at a time (chat list OR open conversation), which is the standard,
// reliable pattern real messaging apps use on small screens.
export default function MobileChatShell(props: {
  isGuest: boolean
  profile: Profile
  view: 'global' | 'dms'
  setRailView: (v: 'global' | 'dms') => void
  promptSignup: () => void
  currentRoom: RoomWithPreview | null
  currentRoomId: string | null
  showingChat: boolean
  setShowingChat: (v: boolean) => void
  onlineMembers: Profile[]
  memberSearch: string
  setMemberSearch: (v: string) => void
  startDm: (u: Profile) => void
  dmSearch: string
  searchUsers: (q: string) => void
  searchResults: Profile[]
  myRooms: RoomWithPreview[]
  openRoom: (id: string, room: RoomWithPreview) => void
  setRoomModalOpen: (v: boolean) => void
  messages: Message[]
  messagesLoading: boolean
  composerText: string
  setComposerText: (v: string) => void
  sendMessage: () => void
  fileInputRef: React.RefObject<HTMLInputElement>
  handleFileSelected: (e: React.ChangeEvent<HTMLInputElement>) => void
  themePopoverOpen: boolean
  setThemePopoverOpen: (v: boolean | ((prev: boolean) => boolean)) => void
  setTheme: (t: string) => void
  signOut: () => void
  groupMenuOpen: boolean
  setGroupMenuOpen: (v: boolean | ((prev: boolean) => boolean)) => void
  deleteGroup: (room: RoomWithPreview) => void
  leaveGroup: (room: RoomWithPreview) => void
  deleteAllMyLogs: () => void
}) {
  const {
    isGuest, profile, view, setRailView, promptSignup,
    currentRoom, showingChat, setShowingChat,
    onlineMembers, memberSearch, setMemberSearch, startDm,
    dmSearch, searchUsers, searchResults, myRooms, openRoom, setRoomModalOpen,
    messages, messagesLoading, composerText, setComposerText, sendMessage,
    fileInputRef, handleFileSelected,
    themePopoverOpen, setThemePopoverOpen, setTheme, signOut,
    groupMenuOpen, setGroupMenuOpen, deleteGroup, leaveGroup, deleteAllMyLogs,
  } = props

  const messagesContainerRef = useRef<HTMLDivElement>(null)

  // ===================== CHAT OPEN: full-screen conversation =====================
  if (showingChat && currentRoom) {
    return (
      <div className="m-screen">
        <div className="m-chat-header">
          <button className="m-back-btn" onClick={() => setShowingChat(false)} aria-label="Back">‹</button>
          <div className="avatar room" style={{ width: 32, height: 32, fontSize: 12 }}>{currentRoom.icon ?? '💬'}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="m-chat-title">{currentRoom.name}</div>
            <div className="m-chat-subtitle">
              {currentRoom.type === 'global' ? 'Open to everyone' : currentRoom.type === 'dm' ? 'Direct message' : 'Group room'}
            </div>
          </div>
          {currentRoom.type === 'group' && (
            <div style={{ position: 'relative' }}>
              <button className="icon-btn" onClick={() => setGroupMenuOpen((v) => !v)}>⋮</button>
              {groupMenuOpen && (
                <div className="theme-popover show" style={{ position: 'fixed', top: 56, right: 14, left: 'auto', bottom: 'auto', width: 170 }}>
                  {currentRoom.created_by === profile.id ? (
                    <button className="signout-btn" style={{ marginTop: 0 }} onClick={() => { setGroupMenuOpen(false); deleteGroup(currentRoom) }}>Delete group</button>
                  ) : (
                    <button className="signout-btn" style={{ marginTop: 0 }} onClick={() => { setGroupMenuOpen(false); leaveGroup(currentRoom) }}>Leave group</button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="m-messages" ref={messagesContainerRef}>
          {messagesLoading ? (
            <div className="messages-empty"><span className="spinner" style={{ borderTopColor: 'var(--accent)', borderColor: 'var(--border)' }} /></div>
          ) : messages.length === 0 ? (
            <div className="messages-empty">
              <div className="icon">🫧</div>
              <div className="title">No messages yet</div>
              <div className="sub">Be the first to say something here.</div>
            </div>
          ) : (
            messages.map((m, idx) => {
              const grouped = idx > 0 && messages[idx - 1].author_id === m.author_id
              return (
                <div key={m.id} className={`msg-row ${grouped ? 'grouped' : ''}`}>
                  {grouped ? <div className="avatar-spacer" /> : (
                    <div className="avatar" style={{ background: m.author?.avatar_color }}>{m.author?.username?.slice(0, 2).toUpperCase() ?? '?'}</div>
                  )}
                  <div className="msg-body">
                    {!grouped && (
                      <div className="msg-meta">
                        <span className="author">{m.author?.username ?? 'Deleted user'}</span>
                        <span className="time">{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    )}
                    {m.text && <div className="msg-text">{m.text}</div>}
                    {m.media_url && m.media_type === 'image' && <div className="msg-media"><img src={m.media_url} alt="shared image" loading="lazy" /></div>}
                    {m.media_url && m.media_type === 'video' && <div className="msg-media"><video src={m.media_url} controls /></div>}
                  </div>
                </div>
              )
            })
          )}
        </div>

        <div className="m-composer">
          <input ref={fileInputRef} type="file" accept="image/*,video/*" style={{ display: 'none' }} onChange={handleFileSelected} />
          <button className="attach-btn" disabled={isGuest} onClick={() => (isGuest ? promptSignup() : fileInputRef.current?.click())}>📎</button>
          <div className="composer-inner">
            <input
              type="text"
              placeholder={`Message ${currentRoom.name}...`}
              value={composerText}
              onChange={(e) => setComposerText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') sendMessage() }}
            />
          </div>
          <button className="send-btn" onClick={sendMessage}>➤</button>
        </div>
      </div>
    )
  }

  // ===================== CHAT LIST: tabs + list, no chat open =====================
  return (
    <div className="m-screen">
      <div className="m-list-header">
        <div className="m-tabs">
          <button className={`m-tab ${view === 'global' ? 'active' : ''}`} onClick={() => setRailView('global')}>🌐 Global</button>
          <button className={`m-tab ${view === 'dms' ? 'active' : ''} ${isGuest ? 'disabled' : ''}`} onClick={() => setRailView('dms')}>💬 Messages</button>
        </div>
        <div style={{ position: 'relative' }}>
          <button className="m-account-btn" onClick={() => (isGuest ? promptSignup() : setThemePopoverOpen((v) => !v))}>
            {isGuest ? 'G' : (profile.username?.slice(0, 2).toUpperCase() ?? '··')}
          </button>
          {themePopoverOpen && !isGuest && (
            <div className="theme-popover show" style={{ position: 'fixed', top: 56, right: 14, left: 'auto', bottom: 'auto' }}>
              <h4>Chat theme</h4>
              <div className="theme-grid">
                {(['coral', 'teal', 'violet', 'amber'] as const).map((t) => (
                  <div key={t} className={`theme-swatch sw-${t} ${profile.theme === t ? 'selected' : ''}`} onClick={() => setTheme(t)} />
                ))}
              </div>
              <button className="signout-btn" onClick={signOut}>Sign out</button>
            </div>
          )}
        </div>
      </div>

      {view === 'global' ? (
        <>
          <div className="search-bar" style={{ margin: '0 14px 12px' }}>
            <input type="text" placeholder="Search members..." value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)} />
          </div>
          <div className="list-scroll">
            <button className="m-list-item" onClick={() => setShowingChat(true)}>
              <div className="avatar room" style={{ background: 'linear-gradient(135deg,#5EEAD4,#8af0de)' }}>🌐</div>
              <div className="chat-item-text">
                <div className="name">Global Chat</div>
                <div className="preview">Open to everyone</div>
              </div>
            </button>
            {onlineMembers.filter((m) => m.username.toLowerCase().includes(memberSearch.toLowerCase())).length === 0 ? (
              <div className="empty-state">
                <div className="sub">No one else is online right now.</div>
              </div>
            ) : (
              onlineMembers
                .filter((m) => m.username.toLowerCase().includes(memberSearch.toLowerCase()))
                .map((m) => (
                  <button key={m.id} className="m-list-item" onClick={() => (isGuest ? promptSignup() : startDm(m))}>
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
        </>
      ) : (
        <>
          <div className="search-bar" style={{ margin: '0 14px 12px' }}>
            <input type="text" placeholder="Search people to DM..." value={dmSearch} onChange={(e) => searchUsers(e.target.value)} />
          </div>
          <button className="new-dm-btn" style={{ margin: '0 14px 14px', width: 'calc(100% - 28px)' }} onClick={() => setRoomModalOpen(true)}>
            + Start a group room
          </button>
          <div className="list-scroll">
            {dmSearch.trim() ? (
              searchResults.length === 0 ? (
                <div className="empty-state"><div className="sub">No accounts found matching &quot;{dmSearch}&quot;</div></div>
              ) : (
                searchResults.map((u) => (
                  <button key={u.id} className="m-list-item" onClick={() => startDm(u)}>
                    <div className="avatar" style={{ background: u.avatar_color }}>
                      {u.username.slice(0, 2).toUpperCase()}
                      <span className={`status-dot ${u.status}`} />
                    </div>
                    <div className="chat-item-text">
                      <div className="name">{u.username}</div>
                      <div className="preview">{u.status}</div>
                    </div>
                  </button>
                ))
              )
            ) : myRooms.length === 0 ? (
              <div className="empty-state">
                <div className="icon">✉️</div>
                <div className="title">No messages yet</div>
                <div className="sub">Search for someone above to start a DM, or create a group room.</div>
              </div>
            ) : (
              myRooms.map((r) => (
                <button key={r.id} className="m-list-item" onClick={() => { openRoom(r.id, r); setShowingChat(true) }}>
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
        </>
      )}

      {isGuest && (
        <div className="guest-banner">
          You&apos;re browsing as a <b onClick={promptSignup}>Guest</b>. <b onClick={promptSignup}>Create a free account</b> to DM people and join rooms.
        </div>
      )}

      <button className="m-delete-logs-btn" onClick={deleteAllMyLogs}>🗑️ Delete logs for me</button>
    </div>
  )
}
