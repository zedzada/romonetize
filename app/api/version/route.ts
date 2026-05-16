import { NextResponse } from "next/server";

/**
 * GET /api/version
 * 
 * Deployment marker endpoint for diagnosing deployment issues.
 * Returns current deployment information including commit, environment, and timestamp.
 */
export async function GET() {
  return NextResponse.json({
    app: "RoMonetize",
    version: "prelaunch-debug-1",
    deployedAt: new Date().toISOString(),
    buildTime: process.env.NEXT_PUBLIC_BUILD_TIME || "unknown",
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "unknown",
    commitFull: process.env.VERCEL_GIT_COMMIT_SHA || "unknown",
    branch: process.env.VERCEL_GIT_COMMIT_REF || "unknown",
    environment: process.env.VERCEL_ENV || "development",
    region: process.env.VERCEL_REGION || "unknown",
    url: process.env.VERCEL_URL || "localhost",
    projectId: process.env.VERCEL_PROJECT_ID || "unknown",
    // Debug: check if key env vars exist (not their values)
    envCheck: {
      NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      STRIPE_SECRET_KEY: !!process.env.STRIPE_SECRET_KEY,
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: !!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    },
  });
}
