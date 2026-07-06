import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { Avatar, Button, ErrorNote, Input, SectionLabel, Sheet, Textarea } from "../../ui";
import { MediaQueryBar, useComposerAttachments } from "../../ui/attachments";
import { IconX } from "../../ui/icons";

type Target = { kind: "user"; id: string; name: string; email: string } | { kind: "guest"; name: string };

/**
 * Supporter-created request — logged for an existing user (walk-up, phone
 * call) or a guest who isn't in the user list. Web twin of
 * apps/mobile/app/new-request.tsx. Mount only while open so state resets.
 */
export function NewRequestSheet({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useAuth((s) => s.user);

  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<Target | null>(null);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const att = useComposerAttachments();

  const { data } = useQuery({ queryKey: ["directory"], queryFn: () => api.directory(), staleTime: 5 * 60_000 });

  const q = query.trim().toLowerCase();
  const matches =
    q.length > 0 && !target
      ? (data?.users ?? [])
          .filter((u) => u.id !== me?.id && (u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)))
          .slice(0, 4)
      : [];

  const create = useMutation({
    mutationFn: (t: Target) =>
      api.createRequest({
        title: title.trim(),
        body: details.trim(),
        channel: "web",
        attachmentIds: att.ids,
        onBehalf: t.kind === "user" ? { userId: t.id } : { guestName: t.name },
      }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["requests"] });
      onClose();
      navigate(`/requests/${res.request.id}`);
    },
  });

  const canCreate = !!target && title.trim().length >= 3 && !create.isPending && !att.uploading;

  return (
    <Sheet open onClose={onClose} title="New request">
      <p className="-mt-1 mb-4 text-[13px] text-ink-secondary">Log an issue for a user — or a guest who isn't in kloop.</p>

      <div className="flex flex-col gap-3">
        <SectionLabel>Who is it for?</SectionLabel>
        {target ? (
          <div className="flex items-center gap-3 rounded-inner bg-mint p-3">
            <Avatar name={target.name} size={34} tint />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-bold text-ink">{target.name}</div>
              <div className="truncate text-[12px] text-ink-secondary">
                {target.kind === "user" ? target.email : "Guest — tracked by name only"}
              </div>
            </div>
            <button
              aria-label="Clear person"
              onClick={() => {
                setTarget(null);
                setQuery("");
              }}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink/10 text-primary cursor-pointer"
            >
              <IconX size={12} />
            </button>
          </div>
        ) : (
          <>
            <Input autoFocus placeholder="Search people, or type a guest's name…" value={query} onChange={(e) => setQuery(e.target.value)} />
            {matches.map((u) => (
              <button
                key={u.id}
                onClick={() => setTarget({ kind: "user", id: u.id, name: u.name, email: u.email })}
                className="flex w-full items-center gap-3 rounded-inner bg-card p-3 text-left shadow-card cursor-pointer transition-shadow hover:shadow-float"
              >
                <Avatar name={u.name} size={34} tint />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold text-ink">{u.name}</span>
                  <span className="block truncate text-[12px] text-ink-secondary">{u.email}</span>
                </span>
                <span className="text-ink-faint">›</span>
              </button>
            ))}
            {q.length > 0 && (
              <button
                onClick={() => setTarget({ kind: "guest", name: query.trim() })}
                className="flex w-full items-center gap-3 rounded-inner border border-dashed border-line bg-card p-3 text-left cursor-pointer transition-colors hover:bg-surface"
              >
                <Avatar name={query.trim()} size={34} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold text-ink">Add "{query.trim()}" as guest</span>
                  <span className="block text-[12px] text-ink-secondary">No account needed — for your own tracking</span>
                </span>
              </button>
            )}
          </>
        )}

        <SectionLabel className="mt-2">What's the problem?</SectionLabel>
        <Input placeholder="Scanner gun won't pair after battery swap…" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Textarea rows={3} placeholder="Details (optional)" value={details} onChange={(e) => setDetails(e.target.value)} />

        <MediaQueryBar att={att} />

        {create.isError && <ErrorNote>{(create.error as Error).message}</ErrorNote>}
        <Button size="lg" disabled={!canCreate} loading={create.isPending || att.uploading} onClick={() => target && create.mutate(target)}>
          Create request
        </Button>
      </div>
    </Sheet>
  );
}
