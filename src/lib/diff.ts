export type Tracked = {
  title: string;
  description: string;
  tags: string[];
  categoryId: string | null;
  privacyStatus: string | null;
  thumbnailHash: string | null;
};

export type Field = "title" | "description" | "tags" | "category" | "privacy" | "thumbnail" | "note";
export type FieldChange = { field: Field; oldValue: string | null; newValue: string | null };

/** Field-level differences between two snapshots of a video. */
export function diffVideo(prev: Tracked, next: Tracked): FieldChange[] {
  const out: FieldChange[] = [];
  const add = (field: Field, a: string | null, b: string | null) => {
    if (a !== b) out.push({ field, oldValue: a, newValue: b });
  };
  add("title", prev.title, next.title);
  add("description", prev.description, next.description);
  add("tags", JSON.stringify(prev.tags), JSON.stringify(next.tags));
  add("category", prev.categoryId, next.categoryId);
  add("privacy", prev.privacyStatus, next.privacyStatus);
  // A failed thumbnail download (null) is not a change.
  if (prev.thumbnailHash && next.thumbnailHash) add("thumbnail", prev.thumbnailHash, next.thumbnailHash);
  return out;
}

export function diffTags(oldJson: string | null, newJson: string | null) {
  const a: string[] = JSON.parse(oldJson ?? "[]");
  const b: string[] = JSON.parse(newJson ?? "[]");
  return { added: b.filter((t) => !a.includes(t)), removed: a.filter((t) => !b.includes(t)) };
}
