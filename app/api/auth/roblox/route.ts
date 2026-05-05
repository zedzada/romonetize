import { NextResponse } from "next/server";
import crypto from "crypto";

const ROBLOX_CLIENT_ID = "6125409488143470452";
const REDIRECT_URI = "https://www.romonetize.com/api/auth/roblox/callback";
const SCOPES = [
  "openid",
  "profile", 
  "universe-messaging-service:publish",
  "universe-datastores.objects:read",
  "universe-datastores.objects:write",
];

export async function GET() {
  // Generate PKCE code verifier and challenge
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  // Generate state for CSRF protection
  const state = crypto.randomBytes(16).toString("hex");

  // Build the authorization URL
  const authUrl = new URL("https://apis.roblox.com/oauth/v1/authorize");
  authUrl.searchParams.set("client_id", ROBLOX_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPES.join(" "));
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  // Create response with redirect
  const response = NextResponse.redirect(authUrl.toString());

  // Store code verifier and state in cookies for the callback
  response.cookies.set("roblox_code_verifier", codeVerifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/",
  });

  response.cookies.set("roblox_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/",
  });

  return response;
}
