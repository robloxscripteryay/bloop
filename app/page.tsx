import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import ChatShell from '@/components/ChatShell'

export default async function HomePage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile) {
    // Auth user exists but the profile-creation trigger hasn't caught up yet —
    // send them back through login rather than crashing on a null profile.
    redirect('/login')
  }

  const isGuest = user.is_anonymous === true

  return <ChatShell initialProfile={profile} isGuest={isGuest} />
}
