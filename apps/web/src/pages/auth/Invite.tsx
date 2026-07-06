import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApiError } from "@kloop/shared";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { appDeepLink, isMobileUserAgent } from "../../lib/deepLink";
import { Button, ErrorNote, Input } from "../../ui";

/** Landing page for invitation emails: /auth/invite?token=... */
export function InvitePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const setSession = useAuth((s) => s.setSession);
  const token = params.get("token") ?? "";
  const appLink = isMobileUserAgent() ? appDeepLink("auth/invite", token || null) : null;

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await api.acceptInvite(token, name.trim(), password);
      setSession(res.token, res.user);
      navigate(res.user.role === "requester" ? "/" : "/queue", { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not accept the invitation.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-sm flex-col justify-center px-6 py-12">
      <div className="fade-up">
        <h1 className="text-[28px] font-bold tracking-tight">Join your team on kloop</h1>
        <p className="mt-1 text-[14px] text-ink-secondary">Set up your account to accept the invitation.</p>
        <form
          className="mt-8 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Input required autoFocus placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input
            type="password"
            required
            minLength={8}
            placeholder="Choose a password (min. 8 characters)"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <ErrorNote>{error}</ErrorNote>}
          <Button type="submit" size="lg" loading={busy}>
            Create account
          </Button>
        </form>
        {appLink && (
          <a href={appLink} className="mt-4 block">
            <Button variant="secondary" className="w-full">
              Open in the kloop app
            </Button>
          </a>
        )}
      </div>
    </div>
  );
}
