import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { timeAgo } from "../../lib/format";
import { PageHeader } from "../../shell/AppShell";
import { Avatar, Button, Card, ErrorNote, ErrorState, Input, SectionLabel, Segmented, Sheet, Spinner } from "../../ui";
import { IconCheck, IconDots, IconPlus } from "../../ui/icons";

const ROLES = ["requester", "supporter", "admin"] as const;
type Role = (typeof ROLES)[number];

const ROLE_BADGE: Record<Role, string> = {
  requester: "bg-chip text-ink-secondary",
  supporter: "bg-mint text-primary",
  admin: "bg-ink text-white",
};

export function UsersPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const me = useAuth((s) => s.user);
  const [addOpen, setAddOpen] = useState(false);

  const { data: usersData, isLoading, error, refetch } = useQuery({ queryKey: ["org-users"], queryFn: () => api.orgUsers() });
  const { data: invData } = useQuery({ queryKey: ["invitations"], queryFn: () => api.invitations() });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["org-users"] });
    void qc.invalidateQueries({ queryKey: ["invitations"] });
  };

  const updateUser = useMutation({
    mutationFn: (args: { id: string; patch: { role?: string; deactivated?: boolean } }) => api.updateUser(args.id, args.patch),
    onSuccess: invalidate,
  });
  const revoke = useMutation({ mutationFn: (id: string) => api.revokeInvitation(id), onSuccess: invalidate });

  if (error && !usersData) return <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />;
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
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <IconPlus size={15} /> Add person
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
                  <span className="block text-[12px] text-ink-secondary">
                    Invited {timeAgo(i.createdAt)} ago · waiting to accept
                  </span>
                </span>
                <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[11px] font-bold capitalize ${ROLE_BADGE[i.role as Role] ?? ROLE_BADGE.requester}`}>
                  {i.role}
                </span>
                <RowMenu items={[{ label: "Revoke invitation", danger: true, onSelect: () => revoke.mutate(i.id) }]} />
              </div>
            ))}
          </Card>
        </>
      )}

      <SectionLabel className="mb-2 px-1">Members · {users.filter((u) => !u.deactivatedAt).length}</SectionLabel>
      <Card className="divide-y divide-line">
        {users.map((u) => {
          const self = u.id === me?.id;
          return (
            <div key={u.id} className={`flex items-center gap-3 px-4 py-3 ${u.deactivatedAt ? "opacity-50" : ""}`}>
              <Avatar name={u.name} size={36} tint={u.role !== "requester"} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {u.name}
                  {self && <span className="text-ink-faint"> (you)</span>}
                </span>
                <span className="block truncate text-[12px] text-ink-secondary">
                  {u.email}
                  {u.deactivatedAt ? " · deactivated" : u.lastSeenAt ? ` · seen ${timeAgo(u.lastSeenAt)} ago` : ""}
                </span>
              </span>
              <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[11px] font-bold capitalize ${ROLE_BADGE[u.role as Role]}`}>
                {u.role}
              </span>
              {!self && (
                <RowMenu
                  items={[
                    ...ROLES.map((r) => ({
                      label: r.charAt(0).toUpperCase() + r.slice(1),
                      checked: u.role === r,
                      disabled: !!u.deactivatedAt,
                      onSelect: () => u.role !== r && updateUser.mutate({ id: u.id, patch: { role: r } }),
                    })),
                    {
                      label: u.deactivatedAt ? "Reactivate" : "Deactivate",
                      danger: !u.deactivatedAt,
                      separator: true,
                      onSelect: () => updateUser.mutate({ id: u.id, patch: { deactivated: !u.deactivatedAt } }),
                    },
                  ]}
                />
              )}
            </div>
          );
        })}
      </Card>

      <AddPersonSheet open={addOpen} onClose={() => setAddOpen(false)} onDone={invalidate} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Row overflow menu                                                   */
/* ------------------------------------------------------------------ */
type MenuItem = { label: string; onSelect: () => void; checked?: boolean; danger?: boolean; disabled?: boolean; separator?: boolean };

function RowMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        aria-label="More actions"
        onClick={() => setOpen((v) => !v)}
        className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors cursor-pointer ${
          open ? "bg-chip text-ink" : "text-ink-secondary hover:bg-chip hover:text-ink"
        }`}
      >
        <IconDots size={17} />
      </button>
      {open && (
        <div className="glass-strong fade-up absolute right-0 top-9 z-30 w-44 rounded-inner py-1.5">
          {items.map((it) => (
            <div key={it.label}>
              {it.separator && <div className="my-1.5 border-t border-line" />}
              <button
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onSelect();
                }}
                className={`flex w-full items-center justify-between px-3.5 py-2 text-left text-[13px] font-medium transition-colors cursor-pointer disabled:cursor-default disabled:opacity-40 ${
                  it.danger ? "text-danger hover:bg-danger-soft" : "text-ink hover:bg-chip"
                }`}
              >
                {it.label}
                {it.checked && <IconCheck size={14} className="text-primary" />}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Add person: invite by email, or create the account directly         */
/* ------------------------------------------------------------------ */
function AddPersonSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<"invite" | "create">("invite");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("requester");

  const reset = () => {
    setName("");
    setEmail("");
    setPassword("");
    setRole("requester");
  };

  const invite = useMutation({
    mutationFn: () => api.invite(email.trim(), role),
    onSuccess: () => {
      onDone();
      onClose();
      reset();
    },
  });
  const create = useMutation({
    mutationFn: () => api.createUser({ name: name.trim(), email: email.trim(), password, role }),
    onSuccess: () => {
      onDone();
      onClose();
      reset();
    },
  });

  const m = mode === "invite" ? invite : create;
  const valid = email.includes("@") && (mode === "invite" || (name.trim().length > 0 && password.length >= 8));

  return (
    <Sheet open={open} onClose={onClose} title="Add person">
      <div className="flex flex-col gap-3">
        <Segmented
          options={[
            { value: "invite" as const, label: "Send invite" },
            { value: "create" as const, label: "Create account" },
          ]}
          value={mode}
          onChange={setMode}
        />
        {mode === "create" && <Input placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />}
        <Input type="email" placeholder="email@company.com" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus={mode === "invite"} />
        {mode === "create" && (
          <Input
            type="text"
            placeholder="Initial password (min. 8 characters)"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
        <div className="flex gap-2">
          {ROLES.map((r) => (
            <button
              key={r}
              onClick={() => setRole(r)}
              className={`flex-1 rounded-full px-3 py-2 text-[13px] font-semibold capitalize transition-colors cursor-pointer ${
                role === r ? "glass-dark text-white" : "glass text-ink hover:bg-white/65"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        {m.isError && <ErrorNote>{(m.error as Error).message}</ErrorNote>}
        <Button size="lg" loading={m.isPending} disabled={!valid} onClick={() => m.mutate()}>
          {mode === "invite" ? "Send invitation" : "Create account"}
        </Button>
        <p className="text-center text-[12px] text-ink-faint">
          {mode === "invite"
            ? "They'll get an email with a link to pick their own name and password."
            : "No email is sent — share the password with them; they can sign in right away."}
        </p>
      </div>
    </Sheet>
  );
}
