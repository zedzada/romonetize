import { createClient, isSupabaseConfigured } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  // If Supabase is not configured, redirect to home
  if (!isSupabaseConfigured) {
    console.warn('[v0] Auth callback called but Supabase is not configured')
    return NextResponse.redirect(`${origin}/`)
  }

  if (code) {
    try {
      const supabase = await createClient()
      const { error } = await supabase.auth.exchangeCodeForSession(code)
      if (!error) {
        return NextResponse.redirect(`${origin}${next}`)
      }
      console.error('[v0] Auth callback error:', error)
    } catch (err) {
      console.error('[v0] Auth callback exception:', err)
    }
  }

  return NextResponse.redirect(`${origin}/?error=auth`)
}
