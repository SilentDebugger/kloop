import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "@kloop/shared";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { Button, ErrorNote, Input, Spinner } from "../../ui";

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setSession = useAuth((s) => s.setSession);

  const { data, isLoading } = useQuery({ queryKey: ["auth-methods"], queryFn: () => api.authMethods() });

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"magic" | "password" | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isLoading || !data) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <Spinner size={26} />
      </div>
    );
  }

  const { org, methods } = data;
  const effectiveMode = mode ?? (methods.magicLink ? "magic" : "password");

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      if (effectiveMode === "magic") {
        await api.requestMagicLink(email.trim());
        setSent(true);
      } else {
        const res = await api.login(email.trim(), password);
        setSession(res.token, res.user);
        navigate(res.user.role === "requester" ? "/" : "/queue", { replace: true });
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-sm flex-col justify-center px-6 py-12">
      <div className="fade-up">
        {/* org logo tile */}
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-[18px] bg-mint text-2xl font-bold text-primary">
          {org.logoUrl ? (
            <img src={org.logoUrl} alt="" className="h-full w-full rounded-[18px] object-cover" />
          ) : (
            org.name.charAt(0).toUpperCase()
          )}
        </div>
        <h1 className="text-[28px] font-bold tracking-tight">{t("login.title", { org: org.name })}</h1>
        <div className="mt-1 text-[14px] text-ink-secondary">{window.location.host}</div>

        {sent ? (
          <div className="mt-8 rounded-card bg-mint p-5">
            <div className="font-semibold text-primary">Check your email</div>
            <p className="mt-1 text-[14px] text-ink">
              If an account exists for <span className="font-medium">{email}</span>, a sign-in link is on its way. It's valid
              for 15 minutes.
            </p>
            <button className="mt-3 text-[13px] font-semibold text-primary cursor-pointer" onClick={() => setSent(false)}>
              Use a different email
            </button>
          </div>
        ) : (
          <form
            className="mt-8 flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <Input
              type="email"
              required
              autoFocus
              placeholder="you@company.com"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {effectiveMode === "password" && (
              <Input
                type="password"
                required
                placeholder="Password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
            {error && <ErrorNote>{error}</ErrorNote>}
            <Button type="submit" size="lg" loading={busy}>
              {effectiveMode === "magic" ? t("login.sendMagicLink") : "Sign in"}
            </Button>

            {methods.oidc && (
              <>
                <div className="my-1 flex items-center gap-3 text-[12px] text-ink-faint">
                  <span className="h-px flex-1 bg-line" />
                  or
                  <span className="h-px flex-1 bg-line" />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  onClick={() => {
                    window.location.href = "/api/auth/oidc/start";
                  }}
                >
                  {methods.oidc.buttonLabel}
                </Button>
              </>
            )}

            {methods.password && methods.magicLink && (
              <button
                type="button"
                className="mt-2 text-center text-[14px] font-semibold text-ink cursor-pointer"
                onClick={() => setMode(effectiveMode === "magic" ? "password" : "magic")}
              >
                {effectiveMode === "magic" ? t("login.usePassword") : t("login.useMagicLink")}
              </button>
            )}
          </form>
        )}

        <p className="mt-16 text-center text-[12px] text-ink-faint">{t("login.footer")}</p>
      </div>
    </div>
  );
}
