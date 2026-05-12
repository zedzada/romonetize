import { createClient, isSupabaseConfigured } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// Ensure a profile exists for new users with default free plan
async function ensureProfileExists(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, email?: string) {
  // Check if profile exists
  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .single();

  if (!existingProfile) {
    // Create profile with default free plan
    const { error } = await supabase.from("profiles").insert({
      id: userId,
      email: email || null,
      plan: "free",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    
    if (error) {
      console.error('[v0] Error creating profile:', error);
    }
  }
}

export async function GET(request: NextRequest) {
  const { searchParams, origin, hash } = request.nextUrl
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'
  const type = searchParams.get('type')

  // If Supabase is not configured, redirect to home
  if (!isSupabaseConfigured) {
    console.warn('[v0] Auth callback called but Supabase is not configured')
    return NextResponse.redirect(`${origin}/`)
  }

  // Check for password recovery flow
  // Supabase sends type=recovery for password reset links
  if (type === 'recovery') {
    // Redirect to reset password page with the code
    const resetUrl = new URL(`${origin}/auth/reset-password`)
    if (code) {
      resetUrl.searchParams.set('code', code)
    }
    return NextResponse.redirect(resetUrl.toString())
  }

  if (code) {
    try {
      const supabase = await createClient()
      const { data, error } = await supabase.auth.exchangeCodeForSession(code)
      
      if (!error && data?.session) {
        // Check if this is a recovery session (user clicked reset password link)
        // The session will have aal1 and the user will have a recovery_sent_at timestamp
        if (data.session.user?.recovery_sent_at) {
          // This is a password recovery - redirect to reset password page
          return NextResponse.redirect(`${origin}/auth/reset-password`)
        }
        
        // Ensure profile exists for new users with default free plan
        await ensureProfileExists(supabase, data.session.user.id, data.session.user.email)
        
        return NextResponse.redirect(`${origin}${next}`)
      }
      console.error('[v0] Auth callback error:', error)
    } catch (err) {
      console.error('[v0] Auth callback exception:', err)
    }
  }

  return NextResponse.redirect(`${origin}/?error=auth`)
}
