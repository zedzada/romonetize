import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_CUSTOM_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// Check if Supabase is configured
const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey)

// Security headers for all responses
function addSecurityHeaders(response: NextResponse): NextResponse {
  // Prevent clickjacking
  response.headers.set('X-Frame-Options', 'DENY')
  // Prevent MIME type sniffing
  response.headers.set('X-Content-Type-Options', 'nosniff')
  // Control referrer information
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  // Minimal permissions
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  // XSS protection (legacy but still useful)
  response.headers.set('X-XSS-Protection', '1; mode=block')
  return response
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  // If Supabase is not configured, allow all routes (no auth protection)
  if (!isSupabaseConfigured) {
    console.warn('[v0] Supabase not configured - skipping auth middleware')
    return addSecurityHeaders(supabaseResponse)
  }

  try {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    })

    const {
      data: { user },
    } = await supabase.auth.getUser()

    // Protect dashboard routes - redirect to home if not logged in
    if (request.nextUrl.pathname.startsWith('/dashboard') && !user) {
      const url = request.nextUrl.clone()
      url.pathname = '/'
      const redirectResponse = NextResponse.redirect(url)
      return addSecurityHeaders(redirectResponse)
    }

    return addSecurityHeaders(supabaseResponse)
  } catch (error) {
    console.error('[v0] Supabase middleware error:', error)
    // On error, allow the request to continue
    return addSecurityHeaders(supabaseResponse)
  }
}
