import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { isAdmin, isSupporter, useAuth } from "../lib/auth";
import { useRealtime } from "../lib/sse";
import { Avatar, CountBadge, Logo } from "../ui";
import {
  IconBell,
  IconBook,
  IconBriefcase,
  IconChart,
  IconCheckBadge,
  IconGear,
  IconHelp,
  IconInbox,
  IconList,
  IconPlug,
  IconSearch,
  IconSparkle,
  IconUsers,
} from "../ui/icons";

type NavItem = {
  to: string;
  label: string;
  icon: (p: { size?: number; className?: string }) => ReactNode;
  badge?: number;
  end?: boolean;
};

export function AppShell({ children }: { children: ReactNode }) {
  useRealtime();
  const { t } = useTranslation();
  const user = useAuth((s) => s.user);
  const supporter = isSupporter(user);
  const admin = isAdmin(user);

  const { data: counts } = useQuery({
    queryKey: ["review-counts"],
    queryFn: () => api.reviewCounts(),
    enabled: supporter,
    refetchInterval: 60_000,
  });
  const { data: notif } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.notifications(),
    refetchInterval: 90_000,
  });

  const reviewBadge = counts?.counts.total ?? 0;
  const unread = notif?.unread ?? 0;

  const tabs: NavItem[] = supporter
    ? [
        { to: "/queue", label: t("nav.queue"), icon: IconInbox },
        { to: "/reviews", label: t("nav.reviews"), icon: IconCheckBadge, badge: reviewBadge },
        { to: "/search", label: t("nav.search"), icon: IconSearch },
        { to: "/my-work", label: t("nav.myWork"), icon: IconBriefcase },
      ]
    : [
        { to: "/", label: t("nav.getHelp"), icon: IconHelp, end: true },
        { to: "/requests", label: t("nav.myRequests"), icon: IconList },
        { to: "/settings", label: t("nav.settings"), icon: IconGear },
      ];

  const sidebarMain: NavItem[] = supporter
    ? [
        ...tabs,
        { to: "/kb", label: t("nav.knowledgeBase"), icon: IconBook },
        { to: "/gaps", label: t("nav.gaps"), icon: IconSparkle },
      ]
    : [
        { to: "/", label: t("nav.getHelp"), icon: IconHelp, end: true },
        { to: "/requests", label: t("nav.myRequests"), icon: IconList },
        { to: "/kb", label: t("nav.knowledgeBase"), icon: IconBook },
      ];

  const sidebarAdmin: NavItem[] = admin
    ? [
        { to: "/admin", label: t("nav.insights"), icon: IconChart, end: true },
        { to: "/admin/org", label: t("nav.orgSettings"), icon: IconGear },
        { to: "/admin/users", label: t("nav.users"), icon: IconUsers },
        { to: "/admin/integrations", label: t("nav.integrations"), icon: IconPlug },
      ]
    : [];

  return (
    <div className="flex min-h-full">
      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-surface px-4 py-6 md:flex">
        <div className="flex items-center gap-2.5 px-2">
          <Logo size={26} />
          <span className="text-lg font-bold tracking-tight">kloop</span>
        </div>
        <nav className="mt-8 flex flex-col gap-1">
          {sidebarMain.map((item) => (
            <SidebarLink key={item.to} item={item} />
          ))}
        </nav>
        {sidebarAdmin.length > 0 && (
          <>
            <div className="section-label mt-7 px-3">{t("nav.admin")}</div>
            <nav className="mt-2 flex flex-col gap-1">
              {sidebarAdmin.map((item) => (
                <SidebarLink key={item.to} item={item} />
              ))}
            </nav>
          </>
        )}
        <div className="mt-auto flex flex-col gap-1">
          <SidebarLink item={{ to: "/notifications", label: "Notifications", icon: IconBell, badge: unread }} />
          {supporter && <SidebarLink item={{ to: "/settings", label: t("nav.settings"), icon: IconGear }} />}
          <UserCard />
        </div>
      </aside>

      {/* content */}
      <main className="min-h-full w-full pb-24 md:pb-8 md:pl-60">{children}</main>

      {/* mobile floating bottom tabs — the pill bar from the mockups */}
      <nav className="fixed inset-x-3 bottom-3 z-30 flex items-center justify-around rounded-full bg-card px-2 py-1 shadow-float md:hidden">
        {tabs.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `relative flex flex-col items-center gap-0.5 rounded-full px-4 py-2 text-[11px] font-semibold transition-colors ${
                isActive ? "text-primary" : "text-ink-secondary"
              }`
            }
          >
            <span className="relative">
              <item.icon size={21} />
              {item.badge ? (
                <span className="absolute -right-2.5 -top-1.5">
                  <CountBadge n={item.badge} />
                </span>
              ) : null}
            </span>
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function SidebarLink({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-inner px-3 py-2.5 text-[14px] font-medium transition-colors ${
          isActive ? "bg-mint text-primary" : "text-ink-secondary hover:bg-chip hover:text-ink"
        }`
      }
    >
      <item.icon size={19} />
      <span className="flex-1">{item.label}</span>
      {item.badge ? <CountBadge n={item.badge} /> : null}
    </NavLink>
  );
}

function UserCard() {
  const user = useAuth((s) => s.user);
  const navigate = useNavigate();
  if (!user) return null;
  return (
    <button
      onClick={() => navigate("/settings")}
      className="mt-2 flex w-full items-center gap-3 rounded-inner px-3 py-2.5 text-left transition-colors hover:bg-chip cursor-pointer"
    >
      <Avatar name={user.name} size={32} tint />
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold text-ink">{user.name}</span>
        <span className="block truncate text-[11px] capitalize text-ink-secondary">{user.role}</span>
      </span>
    </button>
  );
}

/** page header used on mobile: back-less pages show org + avatar */
export function PageHeader({ orgLine, title, right }: { orgLine?: string; title: string; right?: ReactNode }) {
  const user = useAuth((s) => s.user);
  const navigate = useNavigate();
  return (
    <div className="mb-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          {orgLine && <div className="text-[13px] font-semibold text-primary">{orgLine}</div>}
          <h1 className="text-[28px] font-bold tracking-tight text-ink">{title}</h1>
        </div>
        <div className="flex items-center gap-2 pt-1">
          {right}
          <button onClick={() => navigate("/settings")} className="md:hidden cursor-pointer" aria-label="Settings">
            <Avatar name={user?.name} size={36} tint />
          </button>
        </div>
      </div>
    </div>
  );
}
