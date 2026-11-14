import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "./db";
import { sign, verify } from "./crypto";

const COOKIE = "tt_session";
const MAX_AGE = 60 * 60 * 24 * 30;

export type Channel = {
  id: string;
  title: string;
  isDemo: boolean;
  reachMetrics: boolean | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
};

export async function createSession(userId: string) {
  const payload = `${userId}.${Math.floor(Date.now() / 1000) + MAX_AGE}`;
  (await cookies()).set(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

export async function getUserId(): Promise<string | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const i = raw.lastIndexOf(".");
  const payload = raw.slice(0, i);
  if (i < 0 || !verify(payload, raw.slice(i + 1))) return null;
  const [userId, exp] = payload.split(".");
  if (Number(exp) < Date.now() / 1000) return null;
  return userId;
}

/** The signed-in user's channel, or a redirect to the landing page. */
export async function requireChannel(): Promise<Channel> {
  const userId = await getUserId();
  if (!userId) redirect("/");
  const c = await db();
  const r = await c.execute({
    sql: "SELECT id, title, is_demo, reach_metrics, last_synced_at, last_sync_error FROM channels WHERE user_id = ? LIMIT 1",
    args: [userId],
  });
  const row = r.rows[0];
  if (!row) redirect("/?error=no_channel");
  return {
    id: String(row.id),
    title: String(row.title),
    isDemo: Number(row.is_demo) === 1,
    reachMetrics: row.reach_metrics == null ? null : Number(row.reach_metrics) === 1,
    lastSyncedAt: row.last_synced_at as string | null,
    lastSyncError: row.last_sync_error as string | null,
  };
}
