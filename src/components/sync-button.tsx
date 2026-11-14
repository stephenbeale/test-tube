"use client";

import { useFormStatus } from "react-dom";
import { syncNow } from "@/app/actions";

function Button() {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} className="rounded-md border border-line px-3 py-1.5 text-sm font-medium hover:bg-page disabled:opacity-60">
      {pending ? "Syncing…" : "Sync now"}
    </button>
  );
}

export function SyncButton() {
  return (
    <form action={syncNow}>
      <Button />
    </form>
  );
}
