import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { PageHeader } from "../../shell/AppShell";
import { Button, Card, ErrorNote, Input, SectionLabel, Spinner, Toggle } from "../../ui";

const TIER_LABELS = [
  { tier: 0, name: "Suggestions only", desc: "kloop suggests, humans decide. Nothing automated." },
  { tier: 1, name: "AI-drafted replies", desc: "Supporters get a grounded draft; a human always sends." },
  { tier: 2, name: "Auto-answer", desc: "High-confidence matches are answered automatically; 'didn't help' escalates to a human." },
  { tier: 3, name: "Auto-close", desc: "Auto-answered requests close on confirmation or silence after the grace period." },
];

type OrgPayload = {
  org: {
    id: string;
    name: string;
    slug: string;
    domain: string | null;
    logoUrl: string | null;
    theme: Record<string, string>;
    settings?: {
      automationTier: number;
      tagTierOverrides: Record<string, number>;
      authMethods: { magicLink: boolean; password: boolean; oidc: boolean };
      oidc: { issuer: string; clientId: string; clientSecret: string; buttonLabel?: string } | null;
      emailInEnabled: boolean;
      reopenGraceDays: number;
      autoAnswerConfidence: number;
    };
  };
};

export function OrgSettingsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["org"], queryFn: () => api.org() as Promise<OrgPayload> });

  const [name, setName] = useState("");
  const [tier, setTier] = useState(0);
  const [confidence, setConfidence] = useState(0.82);
  const [graceDays, setGraceDays] = useState(7);
  const [emailIn, setEmailIn] = useState(false);
  const [magicLink, setMagicLink] = useState(true);
  const [password, setPassword] = useState(true);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [overrideTag, setOverrideTag] = useState("");
  const [overrideTier, setOverrideTier] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const s = data?.org.settings;
    if (s && !loaded) {
      setName(data.org.name);
      setTier(s.automationTier);
      setConfidence(s.autoAnswerConfidence);
      setGraceDays(s.reopenGraceDays);
      setEmailIn(s.emailInEnabled);
      setMagicLink(s.authMethods.magicLink);
      setPassword(s.authMethods.password);
      setOverrides(s.tagTierOverrides ?? {});
      setLoaded(true);
    }
  }, [data, loaded]);

  const save = useMutation({
    mutationFn: () =>
      api.updateOrg({
        name: name.trim(),
        settings: {
          automationTier: tier,
          autoAnswerConfidence: confidence,
          reopenGraceDays: graceDays,
          emailInEnabled: emailIn,
          tagTierOverrides: overrides,
          authMethods: { magicLink, password, oidc: data?.org.settings?.authMethods.oidc ?? false },
        },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["org"] }),
  });

  if (isLoading || !data?.org.settings) {
    return (
      <div className="flex justify-center pt-24">
        <Spinner size={26} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-24 pt-6 md:pt-10">
      <PageHeader title={t("nav.orgSettings")} />

      {/* branding */}
      <Card className="p-5">
        <SectionLabel>Branding</SectionLabel>
        <div className="mt-3 flex flex-col gap-3">
          <label className="text-[13px] font-medium text-ink-secondary">
            Organization name
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
          </label>
          <div className="text-[13px] text-ink-secondary">
            Workspace URL: <span className="font-mono text-ink">{window.location.origin}</span>
          </div>
        </div>
      </Card>

      {/* automation tiers */}
      <Card className="mt-4 p-5">
        <SectionLabel>Automation tier</SectionLabel>
        <p className="mt-1 text-[13px] text-ink-secondary">How much kloop does on its own. You can override per tag below.</p>
        <input
          type="range"
          min={0}
          max={3}
          step={1}
          value={tier}
          onChange={(e) => setTier(Number(e.target.value))}
          className="mt-4 w-full accent-(--color-primary)"
        />
        <div className="mt-1 flex justify-between text-[11px] font-semibold text-ink-faint">
          {TIER_LABELS.map((tl) => (
            <span key={tl.tier} className={tier === tl.tier ? "text-primary" : ""}>
              {tl.tier}
            </span>
          ))}
        </div>
        <div className="mt-3 rounded-inner bg-mint p-3.5">
          <div className="font-semibold text-primary">
            Tier {tier} — {TIER_LABELS[tier]!.name}
          </div>
          <div className="mt-0.5 text-[13px] text-ink">{TIER_LABELS[tier]!.desc}</div>
        </div>

        {tier >= 2 && (
          <label className="mt-4 block text-[13px] font-medium text-ink-secondary">
            Auto-answer confidence threshold · {Math.round(confidence * 100)}%
            <input
              type="range"
              min={0.5}
              max={1}
              step={0.01}
              value={confidence}
              onChange={(e) => setConfidence(Number(e.target.value))}
              className="mt-1 w-full accent-(--color-primary)"
            />
          </label>
        )}

        {/* per-tag overrides */}
        <SectionLabel className="mt-5">Per-tag overrides</SectionLabel>
        <div className="mt-2 flex flex-col gap-2">
          {Object.entries(overrides).map(([tag, tv]) => (
            <div key={tag} className="flex items-center gap-2 text-[14px]">
              <span className="rounded-full bg-chip px-3 py-1 font-medium">{tag}</span>
              <span className="text-ink-secondary">tier {tv}</span>
              <button
                className="ml-auto text-[13px] font-semibold text-danger cursor-pointer"
                onClick={() => setOverrides(Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== tag)))}
              >
                Remove
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <Input placeholder="tag (e.g. security)" value={overrideTag} onChange={(e) => setOverrideTag(e.target.value)} className="!py-2 flex-1" />
            <select
              value={overrideTier}
              onChange={(e) => setOverrideTier(Number(e.target.value))}
              className="rounded-inner border border-line bg-card px-3 py-2 text-[14px] outline-none cursor-pointer"
            >
              {TIER_LABELS.map((tl) => (
                <option key={tl.tier} value={tl.tier}>
                  tier {tl.tier}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="secondary"
              disabled={!overrideTag.trim()}
              onClick={() => {
                setOverrides({ ...overrides, [overrideTag.trim().toLowerCase()]: overrideTier });
                setOverrideTag("");
              }}
            >
              Add
            </Button>
          </div>
        </div>
      </Card>

      {/* auth + behavior */}
      <Card className="mt-4 divide-y divide-line">
        <div className="flex items-center justify-between px-5 py-4">
          <div>
            <div className="font-medium">Magic-link sign in</div>
            <div className="text-[12px] text-ink-secondary">Email link, no password needed</div>
          </div>
          <Toggle checked={magicLink} onChange={setMagicLink} disabled={!password && magicLink} />
        </div>
        <div className="flex items-center justify-between px-5 py-4">
          <div>
            <div className="font-medium">Password sign in</div>
            <div className="text-[12px] text-ink-secondary">Classic email + password</div>
          </div>
          <Toggle checked={password} onChange={setPassword} disabled={!magicLink && password} />
        </div>
        <div className="flex items-center justify-between px-5 py-4">
          <div>
            <div className="font-medium">Email-in intake</div>
            <div className="text-[12px] text-ink-secondary">Create requests from inbound email (configure in Integrations)</div>
          </div>
          <Toggle checked={emailIn} onChange={setEmailIn} />
        </div>
        <div className="flex items-center justify-between px-5 py-4">
          <div>
            <div className="font-medium">Reopen window</div>
            <div className="text-[12px] text-ink-secondary">Days a requester can reopen a solved request</div>
          </div>
          <Input
            type="number"
            min={0}
            max={90}
            value={graceDays}
            onChange={(e) => setGraceDays(Number(e.target.value))}
            className="!w-20 !py-2 text-center"
          />
        </div>
      </Card>

      {save.isError && (
        <div className="mt-4">
          <ErrorNote>{(save.error as Error).message}</ErrorNote>
        </div>
      )}

      <div className="mt-5">
        <Button size="lg" loading={save.isPending} onClick={() => save.mutate()}>
          {save.isSuccess ? "Saved ✓" : t("common.save")}
        </Button>
      </div>
    </div>
  );
}
