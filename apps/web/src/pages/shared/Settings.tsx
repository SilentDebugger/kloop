import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { isAdmin, useAuth } from "../../lib/auth";
import { PageHeader } from "../../shell/AppShell";
import { Avatar, Button, Card, Input, SectionLabel, Sheet, Toggle } from "../../ui";
import { IconChevron } from "../../ui/icons";

// keys must match PREF_BY_TYPE in apps/server/src/lib/notify.ts
const NOTIFICATION_PREFS: { key: string; label: string }[] = [
  { key: "replies", label: "Replies" },
  { key: "statusChanges", label: "Status changes" },
  { key: "reviewItems", label: "Review items" },
];

export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const clear = useAuth((s) => s.clear);
  const admin = isAdmin(user);
  const [profileOpen, setProfileOpen] = useState(false);
  const [name, setName] = useState(user?.name ?? "");
  const [password, setPassword] = useState("");

  const updatePrefs = useMutation({
    mutationFn: (prefs: Record<string, boolean>) => api.updateProfile({ notificationPrefs: prefs }),
    onSuccess: (res) => setUser(res.user),
  });

  const updateProfile = useMutation({
    mutationFn: () => api.updateProfile({ name: name.trim(), ...(password ? { password } : {}) }),
    onSuccess: (res) => {
      setUser(res.user);
      setProfileOpen(false);
      setPassword("");
    },
  });

  const signOut = async () => {
    await api.logout().catch(() => {});
    clear();
    navigate("/login", { replace: true });
  };

  if (!user) return null;
  const prefs = user.notificationPrefs ?? {};

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-6 md:pt-10">
      <PageHeader title={t("nav.settings")} />

      {/* profile card */}
      <Card as="button" onClick={() => setProfileOpen(true)} className="flex w-full items-center gap-3.5 p-4">
        <Avatar name={user.name} size={44} tint />
        <span className="min-w-0 flex-1 text-left">
          <span className="block font-bold text-ink">{user.name}</span>
          <span className="block text-[13px] capitalize text-ink-secondary">
            {user.role} · {user.email}
          </span>
        </span>
        <IconChevron size={16} className="text-ink-faint" />
      </Card>

      {/* notifications */}
      <SectionLabel className="mb-2 mt-7 px-1">{t("settings.notifications")}</SectionLabel>
      <Card className="divide-y divide-line">
        {NOTIFICATION_PREFS.filter((p) => p.key !== "reviewItems" || user.role !== "requester").map((p) => (
          <div key={p.key} className="flex items-center justify-between px-4 py-3.5">
            <span className="text-[15px] font-medium">{p.label}</span>
            <Toggle
              checked={prefs[p.key] !== false}
              onChange={(v) => updatePrefs.mutate({ ...prefs, [p.key]: v })}
            />
          </div>
        ))}
      </Card>

      {admin && (
        <>
          <SectionLabel className="mb-2 mt-7 px-1">{t("nav.admin")}</SectionLabel>
          <Card className="divide-y divide-line">
            {[
              { to: "/admin", label: t("nav.insights") },
              { to: "/admin/org", label: t("nav.orgSettings") },
              { to: "/admin/users", label: t("nav.users") },
              { to: "/admin/integrations", label: t("nav.integrations") },
            ].map((l) => (
              <Link key={l.to} to={l.to} className="flex items-center justify-between px-4 py-3.5">
                <span className="text-[15px] font-medium">{l.label}</span>
                <IconChevron size={16} className="text-ink-faint" />
              </Link>
            ))}
          </Card>
        </>
      )}

      {/* language + sign out */}
      <Card className="mt-7 divide-y divide-line">
        <div className="flex items-center justify-between px-4 py-3.5">
          <span className="text-[15px] font-medium">{t("settings.language")}</span>
          <select
            value={user.language}
            onChange={(e) => {
              void i18n.changeLanguage(e.target.value);
              api.updateProfile({ language: e.target.value }).then((res) => setUser(res.user)).catch(() => {});
            }}
            className="glass cursor-pointer rounded-full px-3 py-1.5 text-[14px] text-ink outline-none"
          >
            <option value="en">English</option>
          </select>
        </div>
        <button onClick={() => void signOut()} className="w-full px-4 py-3.5 text-left text-[15px] font-medium text-danger cursor-pointer">
          {t("settings.signOut")}
        </button>
      </Card>

      <div className="mt-8 pb-6 text-center text-[12px] text-ink-faint">kloop — ask once, answered forever.</div>

      <Sheet open={profileOpen} onClose={() => setProfileOpen(false)} title="Your profile">
        <div className="flex flex-col gap-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="New password (leave blank to keep)"
            autoComplete="new-password"
          />
          <div className="mt-2 flex gap-2.5">
            <Button variant="secondary" className="flex-1" onClick={() => setProfileOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button className="flex-1" loading={updateProfile.isPending} onClick={() => updateProfile.mutate()}>
              {t("common.save")}
            </Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
