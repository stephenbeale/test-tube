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

export async function addNote(formData: FormData) {
  const channel = await requireChannel();
  const videoId = String(formData.get("videoId") ?? "");
  const text = String(formData.get("text") ?? "").trim().slice(0, 200);
  const date = String(formData.get("date") ?? "");
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date > ptDate()) return;
  const c = await db();
  const owns = (await c.execute({ sql: "SELECT 1 FROM videos WHERE id = ? AND channel_id = ?", args: [videoId, channel.id] })).rows.length;
  if (!owns) return;
  await c.execute({
    sql: "INSERT INTO changes (id, video_id, channel_id, field, old_value, new_value, detected_at, change_date) VALUES (?, ?, ?, 'note', NULL, ?, ?, ?)",
    args: [newId(), videoId, channel.id, text, `${date}T12:00:00.000Z#${newId()}`, date],
  });
  revalidatePath(`/videos/${videoId}`);
}

export async function deleteNote(formData: FormData) {
  const channel = await requireChannel();
  const c = await db();
  await c.execute({ sql: "DELETE FROM changes WHERE id = ? AND channel_id = ? AND field = 'note'", args: [String(formData.get("id")), channel.id] });
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
