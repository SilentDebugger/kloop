import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApiError } from "@kloop/shared";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { Button, ErrorNote, Spinner } from "../../ui";

/** Landing page for magic-link emails: /auth/verify?token=... */
export function VerifyPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const setSession = useAuth((s) => s.setSession);
  const [error, setError] = useState<string | null>(null);
  const fired = useRef(false);

  useEffect(() => {
    const token = params.get("token");
    if (!token) {
      setError("This link is missing its token.");
      return;
    }
    if (fired.current) return;
    fired.current = true;
    api
      .verifyMagicLink(token)
      .then((res) => {
        setSession(res.token, res.user);
        navigate(res.user.role === "requester" ? "/" : "/queue", { replace: true });
      })
      .catch((e: unknown) => {
        setError(e instanceof ApiError ? e.message : "Verification failed.");
      });
  }, [params, navigate, setSession]);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-sm flex-col items-center justify-center gap-4 px-6">
      {error ? (
        <>
          <ErrorNote>{error}</ErrorNote>
          <Button variant="secondary" onClick={() => navigate("/login")}>
            Back to sign in
          </Button>
        </>
      ) : (
        <>
          <Spinner size={26} />
          <div className="text-[14px] text-ink-secondary">Signing you in…</div>
        </>
      )}
    </div>
  );
}
