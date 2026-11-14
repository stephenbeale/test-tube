import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { syncChannel } from "@/lib/sync";

export const maxDuration = 300;

/** Scheduled sync of every connected channel. Vercel Cron sends CRON_SECRET as a bearer token. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const c = await db();
  const channels = (await c.execute("SELECT id FROM channels WHERE is_demo = 0 AND refresh_token_enc IS NOT NULL")).rows;
  const results: Record<string, unknown> = {};
  for (const ch of channels) {
    const id = String(ch.id);
    try {
      results[id] = await syncChannel(id);
    } catch (e) {
      results[id] = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  return NextResponse.json({ synced: channels.length, results });
}
