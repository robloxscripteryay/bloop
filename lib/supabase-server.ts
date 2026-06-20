import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Supabase client for use in Server Components / route handlers.
// Reads the user's auth session from cookies so RLS policies know who's asking.
export async function createServerSupabaseClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // setAll called from a Server Component without middleware refresh —
            // safe to ignore if you have middleware.ts handling session refresh.
          }
        },
      },
    }
  )
}
