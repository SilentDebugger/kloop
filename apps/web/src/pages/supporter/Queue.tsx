import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { RequestSummary } from "@kloop/shared";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { timeAgo } from "../../lib/format";
import { PageHeader } from "../../shell/AppShell";
import { Button, Card, Chip, EmptyState, Segmented, Spinner, TagChip } from "../../ui";

type Scope = "unassigned" | "mine" | "all";

export function QueuePage() {
  const { t } = useTranslation();
  const [scope, setScope] = useState<Scope>("unassigned");
  const [tag, setTag] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["requests", "queue"],
    queryFn: () => api.requests({ view: "queue" }),
    refetchInterval: 45_000,
  });

  const user = useAuth((s) => s.user);
  const all = data?.requests ?? [];
  const open = all.filter((r) => r.status !== "solved");
  const unassigned = open.filter((r) => !r.claimedBy);
  const mine = open.filter((r) => r.claimedBy === user?.id);

  const scoped = scope === "unassigned" ? unassigned : scope === "mine" ? mine : all;
  const allTags = [...new Set(open.flatMap((r) => r.tags))].slice(0, 12);
  const rows = tag ? scoped.filter((r) => r.tags.includes(tag)) : scoped;

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-6 md:pt-10">
      <PageHeader orgLine={undefined} title={t("nav.queue")} />

      <div className="mb-4 flex items-center gap-2 overflow-x-auto pb-1">
        <Segmented<Scope>
          value={scope}
          onChange={setScope}
          options={[
            { value: "unassigned", label: `${t("queue.unassigned")} · ${unassigned.length}` },
            { value: "mine", label: `${t("queue.mine")} · ${mine.length}` },
            { value: "all", label: t("queue.all") },
          ]}
        />
        <Chip onClick={() => setFiltersOpen((f) => !f)} active={filtersOpen || !!tag} className="shrink-0 bg-card shadow-card">
          Filters
        </Chip>
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

      {isLoading ? (
        <div className="flex justify-center pt-16">
          <Spinner size={26} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="Queue is clear" hint={scope === "unassigned" ? "No unclaimed requests right now." : "Nothing here."} />
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

  const sub = [
    r.author?.name,
    r.autoAnswered && r.escalated ? "auto-answer didn't help" : null,
    r.channel === "email" ? "via email-in" : null,
    r.body ? `"${r.body.slice(0, 60)}${r.body.length > 60 ? "…" : ""}"` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Card as="button" onClick={() => navigate(`/requests/${r.id}`)} className="p-4">
      <span className="flex items-start gap-2.5">
        {r.unreadForSupporter && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />}
        <span className="min-w-0 flex-1">
          <span className="block font-semibold leading-snug text-ink">{r.title}</span>
          <span className="mt-0.5 block text-[13px] leading-snug text-ink-secondary">{sub}</span>
        </span>
        <span className="shrink-0 text-[12px] text-ink-faint">{timeAgo(r.createdAt)}</span>
      </span>
      <span className="mt-3 flex items-center gap-1.5">
        {r.tags.slice(0, 3).map((tg) => (
          <TagChip key={tg} tag={tg} />
        ))}
        {r.escalated && <span className="rounded-full bg-mint px-2.5 py-1 text-[12px] font-semibold text-primary">Escalated</span>}
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
