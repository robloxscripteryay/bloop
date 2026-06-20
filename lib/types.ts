// Types mirroring the real Supabase tables (see supabase/migrations for source of truth)

export type Profile = {
  id: string
  username: string
  avatar_color: string
  theme: string
  status: 'online' | 'idle' | 'offline'
  created_at: string
}

export type Room = {
  id: string
  type: 'global' | 'dm' | 'group'
  name: string | null
  icon: string
  created_by: string | null
  created_at: string
}

export type RoomMember = {
  room_id: string
  user_id: string
  joined_at: string
}

export type Message = {
  id: string
  room_id: string
  author_id: string | null
  text: string | null
  media_url: string | null
  media_type: 'image' | 'video' | null
  created_at: string
  // joined client-side for display
  author?: Profile
}
