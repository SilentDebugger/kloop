import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApiError } from "@kloop/shared";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { appDeepLink, isMobileUserAgent } from "../../lib/deepLink";
import { Button, ErrorNote, Spinner } from "../../ui";

/**
 * Landing page for magic-link emails: /auth/verify?token=...
 *
 * Magic-link tokens are single-use, so on phones we must NOT auto-verify:
 * the user may want the kloop app instead, and a burned token would make the
 * in-app sign-in fail. Desktop verifies immediately as before.
 */
export function VerifyPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const setSession = useAuth((s) => s.setSession);
  const [error, setError] = useState<string | null>(null);
  // "choice" = phone: offer app vs browser before consuming the token
  const [mode, setMode] = useState<"auto" | "choice" | "verifying">(() =>
    isMobileUserAgent() ? "choice" : "auto",
  );
  const fired = useRef(false);
  const token = params.get("token");
  const appLink = appDeepLink("auth/verify", token);

  const verify = () => {
    if (!token) {
      setError("This link is missing its token.");
      return;
    }
    if (fired.current) return;
    fired.current = true;
    setMode("verifying");
    api
      .verifyMagicLink(token)
      .then((res) => {
        setSession(res.token, res.user);
        navigate(res.user.role === "requester" ? "/" : "/queue", { replace: true });
      })
      .catch((e: unknown) => {
        setError(e instanceof ApiError ? e.message : "Verification failed.");
      });
  };

  useEffect(() => {
    if (mode === "auto") verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-sm flex-col items-center justify-center gap-4 px-6">
      {error ? (
        <>
          <ErrorNote>{error}</ErrorNote>
          <Button variant="secondary" onClick={() => navigate("/login")}>
            Back to sign in
          </Button>
        </>
      ) : mode === "choice" ? (
        <div className="fade-up flex w-full flex-col gap-3 text-center">
          <h1 className="text-[24px] font-bold tracking-tight">Sign in to kloop</h1>
          <p className="mb-2 text-[14px] text-ink-secondary">Where do you want to continue?</p>
          {appLink && (
            <a href={appLink}>
              <Button size="lg" className="w-full">
                Open the kloop app
              </Button>
            </a>
          )}
          <Button variant="secondary" size="lg" onClick={verify}>
            Continue in this browser
          </Button>
        </div>
      ) : (
        <>
          <Spinner size={26} />
          <div className="text-[14px] text-ink-secondary">Signing you in…</div>
        </>
      )}
    </div>
  );
}
