import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { OnboardingStepId, RequestSummary } from "@kloop/shared";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { timeAgo } from "../../lib/format";
import { PageHeader } from "../../shell/AppShell";
import { Button, Card, Chip, EmptyState, ErrorState, ReplyPreview, Segmented, SectionLabel, Spinner, StatusLine, TagChip } from "../../ui";
import { IconCheck, IconPlus, IconX } from "../../ui/icons";
import { NewRequestSheet } from "./NewRequestSheet";

type Scope = "unassigned" | "mine" | "ai" | "all";

/** Open requests the AI is currently handling (answered, unclaimed, awaiting the user). */
function isAiHandled(r: RequestSummary): boolean {
  return r.autoAnswered && !r.claimedBy && r.status !== "solved";
}

export function QueuePage() {
  const { t } = useTranslation();
  const [scope, setScope] = useState<Scope>("unassigned");
  const [tag, setTag] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["requests", "queue"],
    queryFn: () => api.requests({ view: "queue" }),
    refetchInterval: 45_000,
  });

  const user = useAuth((s) => s.user);
  const all = data?.requests ?? [];
  const open = all.filter((r) => r.status !== "solved");
  // AI-handled requests get their own segment so "Unassigned" means "needs a human"
  const ai = open.filter(isAiHandled);
  const unassigned = open.filter((r) => !r.claimedBy && !isAiHandled(r));
  const mine = open.filter((r) => r.claimedBy === user?.id);

  const scoped = scope === "unassigned" ? unassigned : scope === "mine" ? mine : scope === "ai" ? ai : all;
  const allTags = [...new Set(open.flatMap((r) => r.tags))].slice(0, 12);
  const rows = tag ? scoped.filter((r) => r.tags.includes(tag)) : scoped;

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-6 md:pt-10">
      <PageHeader
        orgLine={undefined}
        title={t("nav.queue")}
        right={
          <Button size="sm" onClick={() => setNewOpen(true)}>
            <IconPlus size={15} /> New request
          </Button>
        }
      />
      {newOpen && <NewRequestSheet onClose={() => setNewOpen(false)} />}

      {user?.role === "admin" && <OnboardingCard onLogRequest={() => setNewOpen(true)} />}

      <div className="mb-4 flex items-center gap-2 overflow-x-auto pb-1">
        <Segmented<Scope>
          value={scope}
          onChange={setScope}
          options={[
            { value: "unassigned", label: `${t("queue.unassigned")} · ${unassigned.length}` },
            { value: "mine", label: `${t("queue.mine")} · ${mine.length}` },
            { value: "ai", label: `✦ AI · ${ai.length}` },
            { value: "all", label: t("queue.all") },
          ]}
        />
        {allTags.length > 0 && (
          <Chip onClick={() => setFiltersOpen((f) => !f)} active={filtersOpen || !!tag} className="shrink-0 bg-card shadow-card">
            Filters
          </Chip>
        )}
      </div>

      {filtersOpen && allTags.length > 0 && (
        <div className="fade-up mb-4 flex flex-wrap gap-1.5">
          {allTags.map((tg) => (
            <Chip key={tg} active={tag === tg} onClick={() => setTag(tag === tg ? null : tg)}>
              {tg}
            </Chip>
          ))}
        </div>
      )}

      {error && !data ? (
        <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="flex justify-center pt-16">
          <Spinner size={26} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title={scope === "ai" ? "AI has nothing in flight" : "Queue is clear"}
          hint={
            scope === "unassigned"
              ? "No unclaimed requests right now."
              : scope === "ai"
                ? "Auto-answered requests awaiting the user will show here."
                : "Nothing here."
          }
        />
      ) : (
        <div className="flex flex-col gap-2.5 pb-8">
          {rows.map((r) => (
            <QueueRow key={r.id} r={r} />
          ))}
        </div>
      )}
    </div>
  );
}

const ONBOARDING_STEPS: { id: OnboardingStepId; label: string; to?: string }[] = [
  { id: "invite_team", label: "Invite your teammates", to: "/admin/users" },
  { id: "choose_tier", label: "Choose an automation tier", to: "/admin/org" },
  { id: "publish_article", label: "Publish your first article", to: "/kb/new" },
  { id: "first_request", label: "Receive your first request" },
  { id: "connect_email", label: "Connect email", to: "/admin/integrations" },
];

/**
 * Getting-started checklist for admins. Steps complete themselves as the org
 * gets set up; the card disappears once everything is done or it's dismissed.
 */
function OnboardingCard({ onLogRequest }: { onLogRequest: () => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["onboarding"], queryFn: () => api.onboarding(), staleTime: 60_000 });
  const dismiss = useMutation({
    mutationFn: () => api.dismissOnboarding(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["onboarding"] }),
  });

  if (!data || data.dismissed || data.complete) return null;
  const doneById = Object.fromEntries(data.steps.map((s) => [s.id, s.done]));
  const doneCount = data.steps.filter((s) => s.done).length;

  return (
    <Card className="fade-up mb-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <SectionLabel>Getting started · {doneCount}/{data.steps.length}</SectionLabel>
          <p className="mt-1 text-[13px] text-ink-secondary">Set up your workspace — each step checks itself off.</p>
        </div>
        <button
          onClick={() => dismiss.mutate()}
          aria-label="Dismiss checklist"
          className="rounded-full p-1 text-ink-faint transition-colors hover:text-ink cursor-pointer"
        >
          <IconX size={16} />
        </button>
      </div>
      <div className="mt-3 flex flex-col gap-1">
        {ONBOARDING_STEPS.map((step) => {
          const done = doneById[step.id] ?? false;
          const inner = (
            <>
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                  done ? "bg-primary text-white" : "border border-line text-transparent"
                }`}
              >
                <IconCheck size={12} />
              </span>
              <span className={done ? "text-ink-faint line-through" : "text-ink"}>{step.label}</span>
              {!done && <span className="ml-auto text-ink-faint">›</span>}
            </>
          );
          const rowClass = "flex items-center gap-2.5 rounded-inner px-2 py-1.5 text-[14px] font-medium";
          if (done) return <span key={step.id} className={rowClass}>{inner}</span>;
          return step.to ? (
            <Link key={step.id} to={step.to} className={`${rowClass} transition-colors hover:bg-surface`}>
              {inner}
            </Link>
          ) : (
            <button key={step.id} onClick={onLogRequest} className={`${rowClass} text-left transition-colors hover:bg-surface cursor-pointer`}>
              {inner}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function QueueRow({ r }: { r: RequestSummary }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const claim = useMutation({
    mutationFn: () => api.claim(r.id),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["requests"] });
      navigate(`/requests/${res.request.id}`);
    },
  });

  const requesterName = r.author?.name ?? (r.guestName ? `${r.guestName} (guest)` : "Guest");
  const meta = r.status === "handled" ? `updated ${timeAgo(r.lastActivityAt)} ago` : `received ${timeAgo(r.createdAt)} ago`;
  const flags = [r.autoAnswered && r.escalated ? "auto-answer didn't help" : null, r.channel === "email" ? "via email-in" : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <Card as="button" onClick={() => navigate(`/requests/${r.id}`)} className="p-4">
      <StatusLine status={r.status === "handled" ? "handled" : "open"} meta={meta} />
      <span className="mt-1.5 block text-[16px] font-bold leading-snug text-ink">{r.title}</span>
      {flags && <span className="mt-0.5 block text-[13px] text-ink-secondary">{flags}</span>}
      {r.body && <ReplyPreview name={requesterName} body={r.body} unread={r.unreadForSupporter} />}
      <span className="mt-3 flex items-center gap-1.5">
        {r.tags.slice(0, 3).map((tg) => (
          <TagChip key={tg} tag={tg} />
        ))}
        {isAiHandled(r) && r.confirmationState === "pending" && (
          <span className="rounded-full bg-mint px-2.5 py-1 text-[12px] font-semibold text-primary">✦ Auto-answered — awaiting user</span>
        )}
        {r.escalated && <span className="rounded-full bg-amber-soft px-2.5 py-1 text-[12px] font-semibold text-amber">Escalated</span>}
        <span className="ml-auto">
          {!r.claimedBy ? (
            <Button
              size="sm"
              variant="secondary"
              className="!bg-mint !text-primary"
              loading={claim.isPending}
              onClick={(e) => {
                e.stopPropagation();
                claim.mutate();
              }}
            >
              {t("queue.claim")}
            </Button>
          ) : (
            <span className="text-[12px] font-medium text-ink-faint">{r.claimer?.name ?? "claimed"}</span>
          )}
        </span>
      </span>
    </Card>
  );
}
