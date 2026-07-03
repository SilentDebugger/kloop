import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { timeAgo } from "../../lib/format";
import { PageHeader } from "../../shell/AppShell";
import { Avatar, Button, Card, ErrorNote, Input, SectionLabel, Sheet, Spinner } from "../../ui";
import { IconPlus } from "../../ui/icons";

const ROLES = ["requester", "supporter", "admin"] as const;

export function UsersPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const me = useAuth((s) => s.user);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]>("requester");

  const { data: usersData, isLoading } = useQuery({ queryKey: ["org-users"], queryFn: () => api.orgUsers() });
  const { data: invData } = useQuery({ queryKey: ["invitations"], queryFn: () => api.invitations() });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["org-users"] });
    void qc.invalidateQueries({ queryKey: ["invitations"] });
  };

  const invite = useMutation({
    mutationFn: () => api.invite(email.trim(), role),
    onSuccess: () => {
      invalidate();
      setInviteOpen(false);
      setEmail("");
    },
  });
  const updateUser = useMutation({
    mutationFn: (args: { id: string; patch: { role?: string; deactivated?: boolean } }) => api.updateUser(args.id, args.patch),
    onSuccess: invalidate,
  });
  const revoke = useMutation({ mutationFn: (id: string) => api.revokeInvitation(id), onSuccess: invalidate });

  if (isLoading) {
    return (
      <div className="flex justify-center pt-24">
        <Spinner size={26} />
      </div>
    );
  }

  const users = usersData?.users ?? [];
  const invitations = invData?.invitations ?? [];

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-16 pt-6 md:pt-10">
      <PageHeader
        title={t("nav.users")}
        right={
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <IconPlus size={15} /> Invite
          </Button>
        }
      />

      {invitations.length > 0 && (
        <>
          <SectionLabel className="mb-2 px-1">Pending invitations</SectionLabel>
          <Card className="mb-6 divide-y divide-line">
            {invitations.map((i) => (
              <div key={i.id} className="flex items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{i.email}</span>
                  <span className="block text-[12px] capitalize text-ink-secondary">
                    {i.role} · invited {timeAgo(i.createdAt)} ago
                  </span>
                </span>
                <button className="text-[13px] font-semibold text-danger cursor-pointer" onClick={() => revoke.mutate(i.id)}>
                  Revoke
                </button>
              </div>
            ))}
          </Card>
        </>
      )}

      <SectionLabel className="mb-2 px-1">Members · {users.filter((u) => !u.deactivatedAt).length}</SectionLabel>
      <Card className="divide-y divide-line">
        {users.map((u) => (
          <div key={u.id} className={`flex items-center gap-3 px-4 py-3 ${u.deactivatedAt ? "opacity-50" : ""}`}>
            <Avatar name={u.name} size={36} tint={u.role !== "requester"} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">
                {u.name}
                {u.id === me?.id && <span className="text-ink-faint"> (you)</span>}
              </span>
              <span className="block truncate text-[12px] text-ink-secondary">
                {u.email}
                {u.lastSeenAt ? ` · seen ${timeAgo(u.lastSeenAt)} ago` : ""}
              </span>
            </span>
            <select
              value={u.role}
              disabled={u.id === me?.id || !!u.deactivatedAt}
              onChange={(e) => updateUser.mutate({ id: u.id, patch: { role: e.target.value } })}
              className="cursor-pointer rounded-full bg-chip px-3 py-1.5 text-[13px] font-medium capitalize outline-none disabled:cursor-default"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            {u.id !== me?.id && (
              <button
                className={`text-[13px] font-semibold cursor-pointer ${u.deactivatedAt ? "text-primary" : "text-danger"}`}
                onClick={() => updateUser.mutate({ id: u.id, patch: { deactivated: !u.deactivatedAt } })}
              >
                {u.deactivatedAt ? "Reactivate" : "Deactivate"}
              </button>
            )}
          </div>
        ))}
      </Card>

      <Sheet open={inviteOpen} onClose={() => setInviteOpen(false)} title="Invite someone">
        <div className="flex flex-col gap-3">
          <Input type="email" placeholder="email@company.com" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          <div className="flex gap-2">
            {ROLES.map((r) => (
              <button
                key={r}
                onClick={() => setRole(r)}
                className={`flex-1 rounded-full px-3 py-2 text-[13px] font-semibold capitalize transition-colors cursor-pointer ${
                  role === r ? "bg-ink text-white" : "bg-chip text-ink"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          {invite.isError && <ErrorNote>{(invite.error as Error).message}</ErrorNote>}
          <Button size="lg" loading={invite.isPending} disabled={!email.includes("@")} onClick={() => invite.mutate()}>
            Send invitation
          </Button>
          <p className="text-center text-[12px] text-ink-faint">They'll get an email with a link to set up their account.</p>
        </div>
      </Sheet>
    </div>
  );
}
