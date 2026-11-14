import { db } from "@/lib/db";
import { getUserId } from "@/lib/session";

export async function GET(_req: Request, { params }: { params: Promise<{ hash: string }> }) {
  const userId = await getUserId();
  if (!userId) return new Response(null, { status: 401 });
  const { hash } = await params;
  const c = await db();
  const row = (
    await c.execute({
      sql: `SELECT t.content_type, t.data FROM thumbnails t
            JOIN videos v ON v.id = t.video_id JOIN channels ch ON ch.id = v.channel_id
            WHERE t.hash = ? AND ch.user_id = ? LIMIT 1`,
      args: [hash, userId],
    })
  ).rows[0];
  if (!row) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(row.data as ArrayBuffer), {
    headers: {
      "content-type": String(row.content_type),
      "cache-control": "private, max-age=31536000, immutable",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
      "x-content-type-options": "nosniff",
    },
  });
}
