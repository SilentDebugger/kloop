import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import { PageHeader } from "../../shell/AppShell";
import { Card, EmptyState, Input, SectionLabel, Spinner, StatusBadge } from "../../ui";
import { IconChevron, IconSearch } from "../../ui/icons";

/** Global hybrid search — articles, requests, and (for supporters) resolutions. */
export function SearchPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 350);
    return () => clearTimeout(id);
  }, [text]);

  const { data, isFetching } = useQuery({
    queryKey: ["search", q],
    queryFn: () => api.search(q),
    enabled: q.length >= 2,
    staleTime: 30_000,
  });

  const hasResults = data && (data.articles.length > 0 || data.requests.length > 0 || data.resolutions.length > 0);

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-6 md:pt-10">
      <PageHeader title={t("nav.search")} />
      <div className="relative">
        <Input
          autoFocus
          placeholder="Search everything — meaning, not just keywords…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="!border-transparent pl-11 shadow-card"
        />
        <IconSearch size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-faint" />
        {isFetching && <Spinner size={16} />}
      </div>

      {!q && <EmptyState icon={<IconSearch size={30} className="text-ink-faint" />} title="Search the whole loop" hint="Articles, requests, and resolutions — hybrid semantic + keyword search." />}

      {q.length >= 2 && data && !hasResults && !isFetching && (
        <EmptyState title="No matches" hint="Try different words — search also matches by meaning." />
      )}

      {hasResults && (
        <div className="fade-up flex flex-col gap-6 pb-8 pt-5">
          {data.articles.length > 0 && (
            <section>
              <SectionLabel className="mb-2 px-1">Articles</SectionLabel>
              <div className="flex flex-col gap-2">
                {data.articles.map((a) => (
                  <Card key={a.id} as="button" onClick={() => navigate(`/kb/${a.id}`)} className="flex items-center gap-3 p-4">
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold leading-snug">{a.title}</span>
                      <span className="mt-0.5 block truncate text-[13px] text-ink-secondary">
                        {a.kb}
                        {a.summary ? ` · ${a.summary}` : ""}
                      </span>
                    </span>
                    <IconChevron size={16} className="shrink-0 text-ink-faint" />
                  </Card>
                ))}
              </div>
            </section>
          )}
          {data.requests.length > 0 && (
            <section>
              <SectionLabel className="mb-2 px-1">Requests</SectionLabel>
              <div className="flex flex-col gap-2">
                {data.requests.map((r) => (
                  <Card key={r.id} as="button" onClick={() => navigate(`/requests/${r.id}`)} className="flex items-center gap-3 p-4">
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold leading-snug">{r.title}</span>
                      <span className="mt-0.5 block text-[13px] text-ink-secondary">
                        {r.ref} · {timeAgo(r.createdAt)} ago
                      </span>
                    </span>
                    <StatusBadge status={r.status} />
                  </Card>
                ))}
              </div>
            </section>
          )}
          {data.resolutions.length > 0 && (
            <section>
              <SectionLabel className="mb-2 px-1">Resolutions</SectionLabel>
              <div className="flex flex-col gap-2">
                {data.resolutions.map((r) => (
                  <Card key={r.id} as="button" onClick={() => navigate(`/requests/${r.requestId}`)} className="p-4">
                    <span className="block text-[14px] leading-snug text-ink">{r.summary}</span>
                    <span className="mt-1 block text-[12px] text-ink-secondary">Resolution · {timeAgo(r.createdAt)} ago</span>
                  </Card>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
