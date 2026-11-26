"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { newId } from "@/lib/crypto";
import { db } from "@/lib/db";
import { ptDate } from "@/lib/dates";
import { destroySession, requireChannel, setActiveChannel } from "@/lib/session";
import { syncChannel } from "@/lib/sync";

export async function syncNow() {
  const channel = await requireChannel();
  if (!channel.isDemo) {
    // The error is stored on the channel and shown on the dashboard.
    await syncChannel(channel.id).catch(() => {});
  }
  revalidatePath("/", "layout");
}

const VISIBILITIES = new Set(["public", "unlisted", "private"]);

/** What the video's visibility was on `date`, pieced together from recorded changes, else its current status. */
async function visibilityOn(c: Awaited<ReturnType<typeof db>>, videoId: string, date: string): Promise<string | null> {
  const before = await c.execute({
    sql: "SELECT new_value FROM changes WHERE video_id = ? AND field = 'privacy' AND change_date <= ? ORDER BY detected_at DESC LIMIT 1",
    args: [videoId, date],
  });
  if (before.rows.length) return before.rows[0].new_value as string | null;
  const after = await c.execute({
    sql: "SELECT old_value FROM changes WHERE video_id = ? AND field = 'privacy' AND change_date > ? AND old_value IS NOT NULL ORDER BY detected_at LIMIT 1",
    args: [videoId, date],
  });
  if (after.rows.length) return after.rows[0].old_value as string | null;
  const now = await c.execute({ sql: "SELECT privacy_status FROM videos WHERE id = ?", args: [videoId] });
  return (now.rows[0]?.privacy_status as string | null) ?? null;
}

/** Edits the creator can record by hand. Values match the `field` names a sync writes. */
const EDITS = new Set(["thumbnail", "title", "description", "tags"]);

/**
 * Records something the creator did on a given day, past or present, saved as a real change so it
 * gets an impact comparison. `kind` is an edit (`text` is an optional detail, such as the new
 * title), a visibility, or "note" (`text` required).
 */
export async function addEvent(formData: FormData) {
  const channel = await requireChannel();
  const videoId = String(formData.get("videoId") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const text = String(formData.get("text") ?? "").trim().slice(0, 200);
  const date = String(formData.get("date") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > ptDate()) return;
  if (kind === "note" ? !text : !VISIBILITIES.has(kind) && !EDITS.has(kind)) return;
  const c = await db();
  const owns = (await c.execute({ sql: "SELECT 1 FROM videos WHERE id = ? AND channel_id = ?", args: [videoId, channel.id] })).rows.length;
  if (!owns) return;
  // Noon plus a unique suffix keeps it sorted on its day and in a group of its own.
  const detectedAt = `${date}T12:00:00.000Z#${newId()}`;
  let field = "note";
  let oldValue: string | null = null;
  let newValue: string | null = text;
  if (EDITS.has(kind)) {
    field = kind;
    newValue = text || null;
  } else if (kind !== "note") {
    field = "privacy";
    newValue = kind;
    const was = await visibilityOn(c, videoId, date);
    oldValue = was === kind ? null : was;
  }
  await c.execute({
    sql: "INSERT INTO changes (id, video_id, channel_id, field, old_value, new_value, detected_at, change_date, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual')",
    args: [newId(), videoId, channel.id, field, oldValue, newValue, detectedAt, date],
  });
  revalidatePath("/", "layout");
}

/** Deletes a change the creator recorded by hand. Changes a sync detected can't be deleted. */
export async function deleteManualChange(formData: FormData) {
  const channel = await requireChannel();
  const c = await db();
  await c.execute({
    sql: "DELETE FROM changes WHERE id = ? AND channel_id = ? AND (source = 'manual' OR field = 'note')",
    args: [String(formData.get("id")), channel.id],
  });
  revalidatePath("/", "layout");
}

export async function switchChannel(formData: FormData) {
  const channel = await requireChannel();
  const id = String(formData.get("channelId") ?? "");
  if (channel.channels.some((c) => c.id === id)) await setActiveChannel(id);
  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signOut() {
  await destroySession();
  redirect("/");
}
