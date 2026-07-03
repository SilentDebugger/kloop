import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import { PageHeader } from "../../shell/AppShell";
import { Button, Card, EmptyState, Spinner } from "../../ui";
import { IconBell } from "../../ui/icons";

export function NotificationsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["notifications"], queryFn: () => api.notifications() });

  const markAll = useMutation({
    mutationFn: () => api.markAllNotificationsRead(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const open = async (id: string, linkPath: string | null) => {
    await api.markNotificationRead(id).catch(() => {});
    void qc.invalidateQueries({ queryKey: ["notifications"] });
    if (linkPath) navigate(linkPath);
  };

  const items = data?.notifications ?? [];

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-6 md:pt-10">
      <PageHeader
        title="Notifications"
        right={
          (data?.unread ?? 0) > 0 ? (
            <Button size="sm" variant="secondary" loading={markAll.isPending} onClick={() => markAll.mutate()}>
              Mark all read
            </Button>
          ) : undefined
        }
      />
      {isLoading ? (
        <div className="flex justify-center pt-16">
          <Spinner size={26} />
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={<IconBell size={32} className="text-ink-faint" />} title="All caught up" hint="Replies, status changes, and review items land here." />
      ) : (
        <div className="flex flex-col gap-2 pb-8">
          {items.map((n) => (
            <Card
              key={n.id}
              as="button"
              onClick={() => void open(n.id, n.linkPath)}
              className={`flex items-start gap-3 p-4 ${n.readAt ? "opacity-70" : ""}`}
            >
              {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />}
              <span className="min-w-0 flex-1">
                <span className={`block leading-snug ${n.readAt ? "font-medium" : "font-semibold"} text-ink`}>{n.title}</span>
                {n.body && <span className="mt-0.5 block text-[13px] text-ink-secondary">{n.body}</span>}
              </span>
              <span className="shrink-0 text-[12px] text-ink-faint">{timeAgo(n.createdAt)}</span>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
