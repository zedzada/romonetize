import { createBrowserClient, type SupabaseClient } from '@supabase/ssr'

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_CUSTOM_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// Check if Supabase is configured
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

// Create a mock client for when Supabase is not configured
function createMockClient(): SupabaseClient {
  const notConfiguredError = { message: 'Supabase is not configured. Please connect Supabase in project settings.' }
  
  return {
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
      signInWithPassword: async () => ({ data: { user: null, session: null }, error: notConfiguredError }),
      signUp: async () => ({ data: { user: null, session: null }, error: notConfiguredError }),
      signOut: async () => ({ error: null }),
      signInWithOAuth: async () => ({ data: { url: null, provider: null }, error: notConfiguredError }),
      resetPasswordForEmail: async () => ({ data: {}, error: notConfiguredError }),
      onAuthStateChange: () => ({ 
        data: { 
          subscription: { 
            id: 'mock',
            callback: () => {},
            unsubscribe: () => {} 
          } 
        } 
      }),
    },
    from: () => ({
      select: () => ({ data: null, error: notConfiguredError }),
      insert: () => ({ data: null, error: notConfiguredError }),
      update: () => ({ data: null, error: notConfiguredError }),
      delete: () => ({ data: null, error: notConfiguredError }),
    }),
  } as unknown as SupabaseClient
}

let client: SupabaseClient | null = null

export function createClient(): SupabaseClient {
  if (!isSupabaseConfigured) {
    if (typeof window !== 'undefined') {
      console.warn('[v0] Supabase environment variables not configured. Auth features disabled.')
    }
    return createMockClient()
  }

  // Use singleton pattern to avoid creating multiple clients
  if (!client) {
    client = createBrowserClient(supabaseUrl!, supabaseAnonKey!)
  }
  
  return client
}
