import { cookies } from "next/headers";
import { after, NextResponse, type NextRequest } from "next/server";
import { encrypt, newId } from "@/lib/crypto";
import { db } from "@/lib/db";
import { exchangeCode, userInfo } from "@/lib/google";
import { createSession } from "@/lib/session";
import { syncChannel } from "@/lib/sync";
import { getMyChannel } from "@/lib/youtube";

export async function GET(req: NextRequest) {
  const fail = (code: string) => NextResponse.redirect(new URL(`/?error=${code}`, req.url));
  const jar = await cookies();
  const state = jar.get("tt_state")?.value;
  jar.delete("tt_state");
  const code = req.nextUrl.searchParams.get("code");
  if (!code || !state || state !== req.nextUrl.searchParams.get("state")) return fail("oauth");

  try {
    const tokens = await exchangeCode(code, req.nextUrl.origin);
    const [info, channel] = await Promise.all([userInfo(tokens.access_token), getMyChannel(tokens.access_token)]);
    if (!channel) return fail("no_channel");

    const c = await db();
    const now = new Date().toISOString();
    await c.execute({
      sql: `INSERT INTO users (id, google_sub, email, name, created_at) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(google_sub) DO UPDATE SET email = excluded.email, name = excluded.name`,
      args: [newId(), info.sub, info.email ?? null, info.name ?? null, now],
    });
    const userId = String((await c.execute({ sql: "SELECT id FROM users WHERE google_sub = ?", args: [info.sub] })).rows[0].id);
    // Google only returns a refresh token on (re)consent; keep the stored one otherwise.
    await c.execute({
      sql: `INSERT INTO channels (id, user_id, title, uploads_playlist_id, access_token_enc, refresh_token_enc, token_expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id, title = excluded.title,
              uploads_playlist_id = excluded.uploads_playlist_id, access_token_enc = excluded.access_token_enc,
              refresh_token_enc = COALESCE(excluded.refresh_token_enc, channels.refresh_token_enc),
              token_expires_at = excluded.token_expires_at`,
      args: [
        channel.id,
        userId,
        channel.title,
        channel.uploadsPlaylistId,
        encrypt(tokens.access_token),
        tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
        Date.now() + tokens.expires_in * 1000,
      ],
    });
    await createSession(userId);
    // First sync runs after the redirect; the dashboard shows progress.
    after(() => syncChannel(channel.id).catch(() => {}));
    return NextResponse.redirect(new URL("/dashboard", req.url));
  } catch (e) {
    console.error("OAuth callback failed", e);
    return fail("oauth");
  }
}
