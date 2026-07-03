import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "./shell/AppShell";
import { isAdmin, isSupporter, useAuth } from "./lib/auth";
import { LoginPage } from "./pages/auth/Login";
import { VerifyPage } from "./pages/auth/Verify";
import { InvitePage } from "./pages/auth/Invite";
import { HomePage } from "./pages/requester/Home";
import { SuggestedAnswerPage } from "./pages/requester/SuggestedAnswer";
import { MyRequestsPage } from "./pages/requester/MyRequests";
import { ThreadPage } from "./pages/thread/Thread";
import { KbBrowserPage } from "./pages/kb/KbBrowser";
import { ArticlePage } from "./pages/kb/Article";
import { ArticleEditorPage } from "./pages/kb/ArticleEditor";
import { QueuePage } from "./pages/supporter/Queue";
import { ReviewsPage } from "./pages/supporter/Reviews";
import { ReviewDetailPage } from "./pages/supporter/ReviewDetail";
import { SearchPage } from "./pages/supporter/Search";
import { MyWorkPage } from "./pages/supporter/MyWork";
import { GapsPage } from "./pages/supporter/Gaps";
import { InsightsPage } from "./pages/admin/Insights";
import { OrgSettingsPage } from "./pages/admin/OrgSettings";
import { UsersPage } from "./pages/admin/Users";
import { IntegrationsPage } from "./pages/admin/Integrations";
import { SettingsPage } from "./pages/shared/Settings";
import { NotificationsPage } from "./pages/shared/Notifications";

function RequireAuth({ children }: { children: ReactNode }) {
  const token = useAuth((s) => s.token);
  const location = useLocation();
  if (!token) return <Navigate to="/login" state={{ from: location }} replace />;
  return <AppShell>{children}</AppShell>;
}

function RequireSupporter({ children }: { children: ReactNode }) {
  const user = useAuth((s) => s.user);
  if (!isSupporter(user)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const user = useAuth((s) => s.user);
  if (!isAdmin(user)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function RoleHome() {
  const user = useAuth((s) => s.user);
  if (isSupporter(user)) return <Navigate to="/queue" replace />;
  return <HomePage />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/verify" element={<VerifyPage />} />
      <Route path="/auth/invite" element={<InvitePage />} />

      <Route path="/" element={<RequireAuth><RoleHome /></RequireAuth>} />
      <Route path="/answer/:articleId" element={<RequireAuth><SuggestedAnswerPage /></RequireAuth>} />
      <Route path="/requests" element={<RequireAuth><MyRequestsPage /></RequireAuth>} />
      <Route path="/requests/:id" element={<RequireAuth><ThreadPage /></RequireAuth>} />
      <Route path="/kb" element={<RequireAuth><KbBrowserPage /></RequireAuth>} />
      <Route path="/kb/new" element={<RequireAuth><RequireSupporter><ArticleEditorPage /></RequireSupporter></RequireAuth>} />
      <Route path="/kb/:id" element={<RequireAuth><ArticlePage /></RequireAuth>} />
      <Route path="/kb/:id/edit" element={<RequireAuth><RequireSupporter><ArticleEditorPage /></RequireSupporter></RequireAuth>} />

      <Route path="/queue" element={<RequireAuth><RequireSupporter><QueuePage /></RequireSupporter></RequireAuth>} />
      <Route path="/reviews" element={<RequireAuth><RequireSupporter><ReviewsPage /></RequireSupporter></RequireAuth>} />
      <Route path="/reviews/:id" element={<RequireAuth><RequireSupporter><ReviewDetailPage /></RequireSupporter></RequireAuth>} />
      <Route path="/search" element={<RequireAuth><RequireSupporter><SearchPage /></RequireSupporter></RequireAuth>} />
      <Route path="/my-work" element={<RequireAuth><RequireSupporter><MyWorkPage /></RequireSupporter></RequireAuth>} />
      <Route path="/gaps" element={<RequireAuth><RequireSupporter><GapsPage /></RequireSupporter></RequireAuth>} />

      <Route path="/admin" element={<RequireAuth><RequireAdmin><InsightsPage /></RequireAdmin></RequireAuth>} />
      <Route path="/admin/org" element={<RequireAuth><RequireAdmin><OrgSettingsPage /></RequireAdmin></RequireAuth>} />
      <Route path="/admin/users" element={<RequireAuth><RequireAdmin><UsersPage /></RequireAdmin></RequireAuth>} />
      <Route path="/admin/integrations" element={<RequireAuth><RequireAdmin><IntegrationsPage /></RequireAdmin></RequireAuth>} />

      <Route path="/settings" element={<RequireAuth><SettingsPage /></RequireAuth>} />
      <Route path="/notifications" element={<RequireAuth><NotificationsPage /></RequireAuth>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
