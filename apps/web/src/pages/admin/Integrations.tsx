import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import { PageHeader } from "../../shell/AppShell";
import { Button, Card, ErrorNote, Input, SectionLabel, Sheet, Spinner, Toggle } from "../../ui";
import { IconPlus, IconQr, IconTrash } from "../../ui/icons";

const WEBHOOK_EVENTS = [
  "request_created",
  "request_solved",
  "request_confirmed",
  "article_published",
  "article_merged",
  "review_item_created",
];

export function IntegrationsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const { data: channels } = useQuery({ queryKey: ["channels"], queryFn: () => api.channels() });
  const { data: keys, isLoading } = useQuery({ queryKey: ["api-keys"], queryFn: () => api.apiKeys() });
  const { data: hooks } = useQuery({ queryKey: ["webhooks"], queryFn: () => api.webhooks() });

  // api keys
  const [keyName, setKeyName] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);
  const createKey = useMutation({
    mutationFn: () => api.createApiKey(keyName.trim()),
    onSuccess: (res) => {
      setNewToken(res.apiKey.token);
      setKeyName("");
      void qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });
  const revokeKey = useMutation({
    mutationFn: (id: string) => api.revokeApiKey(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["api-keys"] }),
  });

  // webhooks
  const [hookOpen, setHookOpen] = useState(false);
  const [hookUrl, setHookUrl] = useState("");
  const [hookEvents, setHookEvents] = useState<string[]>(["request_solved", "article_published"]);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const createHook = useMutation({
    mutationFn: () => api.createWebhook(hookUrl.trim(), hookEvents),
    onSuccess: (res) => {
      setNewSecret(res.webhook.secret);
      setHookOpen(false);
      setHookUrl("");
      void qc.invalidateQueries({ queryKey: ["webhooks"] });
    },
  });
  const toggleHook = useMutation({
    mutationFn: (args: { id: string; active: boolean }) => api.updateWebhook(args.id, { active: args.active }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["webhooks"] }),
  });
  const deleteHook = useMutation({
    mutationFn: (id: string) => api.deleteWebhook(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["webhooks"] }),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center pt-24">
        <Spinner size={26} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-16 pt-6 md:pt-10">
      <PageHeader title={t("nav.integrations")} />

      {/* mobile connect */}
      <Card className="p-5">
        <SectionLabel>Mobile app connect</SectionLabel>
        <p className="mt-1 text-[13px] text-ink-secondary">
          Team members scan this QR in the kloop mobile app, or type the workspace domain.
        </p>
        <div className="mt-3 flex items-center gap-5">
          <ConnectQr url={channels?.api.discoveryUrl ?? `${window.location.origin}/.well-known/kloop.json`} />
          <div className="min-w-0 text-[13px]">
            <div className="font-semibold">{window.location.host}</div>
            <div className="mt-1 break-all text-ink-secondary">{channels?.api.discoveryUrl}</div>
          </div>
        </div>
      </Card>

      {/* email-in */}
      <Card className="mt-4 p-5">
        <SectionLabel>Email-in</SectionLabel>
        {channels?.emailIn.configured ? (
          <>
            <p className="mt-1 text-[13px] text-ink-secondary">
              Point your provider's inbound-email webhook (SendGrid / Mailgun / SES) at this endpoint. Emails become requests
              {channels.emailIn.enabled ? "." : " — currently disabled in Organization settings."}
            </p>
            <code className="mt-2 block break-all rounded-inner bg-chip px-3 py-2 font-mono text-[12px]">{channels.emailIn.endpoint}</code>
          </>
        ) : (
          <p className="mt-1 text-[13px] text-ink-secondary">
            Set <code className="rounded bg-chip px-1 font-mono text-[12px]">EMAIL_IN_WEBHOOK_SECRET</code> in the server environment to enable the email-in endpoint.
          </p>
        )}
      </Card>

      {/* api keys */}
      <Card className="mt-4 p-5">
        <div className="flex items-center justify-between">
          <SectionLabel>API keys</SectionLabel>
        </div>
        <p className="mt-1 text-[13px] text-ink-secondary">
          Full REST access at <code className="rounded bg-chip px-1 font-mono text-[12px]">{channels?.api.baseUrl ?? "/api"}</code> with{" "}
          <code className="rounded bg-chip px-1 font-mono text-[12px]">Authorization: Bearer &lt;key&gt;</code>.
        </p>
        {newToken && (
          <div className="mt-3 rounded-inner bg-mint p-3.5">
            <div className="text-[13px] font-semibold text-primary">Copy this key now — it won't be shown again.</div>
            <code className="mt-1 block break-all font-mono text-[12px]">{newToken}</code>
            <Button size="sm" variant="secondary" className="mt-2" onClick={() => { void navigator.clipboard.writeText(newToken); setNewToken(null); }}>
              Copy & dismiss
            </Button>
          </div>
        )}
        <div className="mt-3 flex flex-col gap-2">
          {(keys?.apiKeys ?? []).map((k) => (
            <div key={k.id} className="flex items-center gap-3 text-[14px]">
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{k.name}</span>
                <span className="block text-[12px] text-ink-secondary">
                  {k.tokenPrefix}… · {k.lastUsedAt ? `used ${timeAgo(k.lastUsedAt)} ago` : "never used"}
                </span>
              </span>
              <button className="text-danger cursor-pointer" onClick={() => revokeKey.mutate(k.id)} aria-label="Revoke key">
                <IconTrash size={16} />
              </button>
            </div>
          ))}
          <div className="flex gap-2">
            <Input placeholder="Key name (e.g. ci-bot)" value={keyName} onChange={(e) => setKeyName(e.target.value)} className="!py-2" />
            <Button size="sm" variant="secondary" disabled={!keyName.trim()} loading={createKey.isPending} onClick={() => createKey.mutate()}>
              <IconPlus size={14} /> Create
            </Button>
          </div>
        </div>
      </Card>

      {/* webhooks */}
      <Card className="mt-4 p-5">
        <div className="flex items-center justify-between">
          <SectionLabel>Outbound webhooks</SectionLabel>
          <Button size="sm" variant="secondary" onClick={() => setHookOpen(true)}>
            <IconPlus size={14} /> Add
          </Button>
        </div>
        {newSecret && (
          <div className="mt-3 rounded-inner bg-mint p-3.5">
            <div className="text-[13px] font-semibold text-primary">Signing secret — verify the X-Kloop-Signature header with it.</div>
            <code className="mt-1 block break-all font-mono text-[12px]">{newSecret}</code>
            <Button size="sm" variant="secondary" className="mt-2" onClick={() => { void navigator.clipboard.writeText(newSecret); setNewSecret(null); }}>
              Copy & dismiss
            </Button>
          </div>
        )}
        <div className="mt-3 flex flex-col gap-3">
          {(hooks?.webhooks ?? []).length === 0 && <p className="text-[13px] text-ink-secondary">Deliver events (HMAC-signed) to your own systems.</p>}
          {(hooks?.webhooks ?? []).map((h) => (
            <div key={h.id} className="flex items-center gap-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[13px]">{h.url}</span>
                <span className="block text-[12px] text-ink-secondary">
                  {h.events.join(", ")}
                  {h.lastDeliveryAt ? ` · last ${timeAgo(h.lastDeliveryAt)} ago (${h.lastStatus})` : ""}
                </span>
              </span>
              <Toggle checked={h.active} onChange={(v) => toggleHook.mutate({ id: h.id, active: v })} />
              <button className="text-danger cursor-pointer" onClick={() => deleteHook.mutate(h.id)} aria-label="Delete webhook">
                <IconTrash size={16} />
              </button>
            </div>
          ))}
        </div>
      </Card>

      <Sheet open={hookOpen} onClose={() => setHookOpen(false)} title="Add webhook">
        <div className="flex flex-col gap-3">
          <Input placeholder="https://example.com/hooks/kloop" value={hookUrl} onChange={(e) => setHookUrl(e.target.value)} autoFocus />
          <SectionLabel>Events</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {WEBHOOK_EVENTS.map((ev) => {
              const on = hookEvents.includes(ev);
              return (
                <button
                  key={ev}
                  onClick={() => setHookEvents(on ? hookEvents.filter((e) => e !== ev) : [...hookEvents, ev])}
                  className={`rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors cursor-pointer ${on ? "glass-dark text-white" : "glass text-ink hover:bg-white/65"}`}
                >
                  {ev}
                </button>
              );
            })}
          </div>
          {createHook.isError && <ErrorNote>{(createHook.error as Error).message}</ErrorNote>}
          <Button size="lg" disabled={!hookUrl.startsWith("http") || hookEvents.length === 0} loading={createHook.isPending} onClick={() => createHook.mutate()}>
            Create webhook
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

function ConnectQr({ url }: { url: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, url, { width: 128, margin: 1, color: { dark: "#1D1B16", light: "#FFFFFF" } }).catch(() => {});
    }
  }, [url]);
  return (
    <div className="flex h-32 w-32 shrink-0 items-center justify-center overflow-hidden rounded-inner bg-white p-1 shadow-card">
      <canvas ref={canvasRef} aria-label="Workspace QR code">
        <IconQr size={40} />
      </canvas>
    </div>
  );
}
