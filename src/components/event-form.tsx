"use client";

import { useRef, useState } from "react";

/** Keep `value`s in sync with EDITS / VISIBILITIES in app/actions.ts. */
const GROUPS: { label: string; kinds: { value: string; label: string }[] }[] = [
  {
    label: "Changed",
    kinds: [
      { value: "thumbnail", label: "Thumbnail" },
      { value: "title", label: "Title" },
      { value: "description", label: "Description" },
      { value: "tags", label: "Tags" },
    ],
  },
  {
    label: "Made",
    kinds: [
      { value: "public", label: "Public" },
      { value: "unlisted", label: "Unlisted" },
      { value: "private", label: "Private" },
    ],
  },
];

const input = "rounded-md border border-line bg-page px-2 py-1.5 text-sm";
const chip = "rounded-md border border-line px-2.5 py-1 text-sm hover:border-ink disabled:opacity-50";

/**
 * Records a change or note for one video in one tap: each button saves straight away, with the
 * optional details (a new title, say) if typed. Note is the only one that needs text.
 * With `fixedDate` the day is already chosen (from the chart); otherwise a date input is shown.
 * `onDone` runs after a successful save, or on Cancel.
 */
export function EventForm({
  action,
  videoId,
  today,
  fixedDate,
  onDone,
  autoFocus = false,
}: {
  action: (formData: FormData) => Promise<void>;
  videoId: string;
  today: string;
  fixedDate?: string;
  onDone?: () => void;
  autoFocus?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const text = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={form}
      action={async (fd) => {
        setPending(true);
        try {
          await action(fd);
          form.current?.reset();
          onDone?.();
        } finally {
          setPending(false);
        }
      }}
      className="space-y-3"
    >
      <input type="hidden" name="videoId" value={videoId} />
      <div className="flex flex-wrap gap-2">
        {!fixedDate && <input type="date" name="date" required defaultValue={today} max={today} aria-label="Date" className={input} />}
        <input
          ref={text}
          // Enter would otherwise "click" the first button (Thumbnail).
          onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
          name="text"
          maxLength={200} placeholder="Details, e.g. the new title (optional)" aria-label="Details" className={`${input} min-w-0 flex-1 basis-48`} />
      </div>
      {fixedDate && <input type="hidden" name="date" value={fixedDate} />}
      {GROUPS.map((g, gi) => (
        <div key={g.label} className="flex flex-wrap items-center gap-1.5" role="group" aria-label={g.label}>
          <span className="w-16 shrink-0 text-xs text-muted">{g.label}</span>
          {g.kinds.map((k, ki) => (
            <button key={k.value} name="kind" value={k.value} disabled={pending} autoFocus={autoFocus && gi === 0 && ki === 0} className={chip}>
              {k.label}
            </button>
          ))}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="w-16 shrink-0 text-xs text-muted">Other</span>
        <button
          name="kind"
          value="note"
          disabled={pending}
          className={chip}
          onClick={(e) => {
            // A note is just the text, so ask for it rather than saving an empty one.
            if (!text.current?.value.trim()) {
              e.preventDefault();
              text.current!.placeholder = "What happened? Then press Note again";
              text.current!.focus();
            }
          }}
        >
          Note
        </button>
        {fixedDate && onDone && (
          <button type="button" onClick={onDone} className="ml-auto text-sm text-muted underline hover:text-ink">
            Cancel
          </button>
        )}
      </div>
      {pending && <p className="text-xs text-muted">Saving…</p>}
    </form>
  );
}
