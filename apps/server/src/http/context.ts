import type { tables } from "../db/index.js";

export type Org = typeof tables.orgs.$inferSelect;
export type User = typeof tables.users.$inferSelect;

export type AppEnv = {
  Variables: {
    org: Org;
    user: User;
    /** set when the request authenticated via API key instead of a session */
    apiKeyId?: string;
  };
};

export type OrgSettings = {
  automationTier: number;
  tagTierOverrides: Record<string, number>;
  authMethods: { magicLink: boolean; password: boolean; oidc: boolean };
  oidc?: { issuer: string; clientId: string; clientSecret: string; buttonLabel?: string };
  emailInEnabled: boolean;
  reopenGraceDays: number;
  autoAnswerConfidence: number;
  onboardingDismissed: boolean;
};

export function orgSettings(org: Org): OrgSettings {
  const s = (org.settings ?? {}) as Partial<OrgSettings>;
  return {
    automationTier: s.automationTier ?? 0,
    tagTierOverrides: s.tagTierOverrides ?? {},
    authMethods: s.authMethods ?? { magicLink: true, password: true, oidc: false },
    oidc: s.oidc,
    emailInEnabled: s.emailInEnabled ?? false,
    reopenGraceDays: s.reopenGraceDays ?? 14,
    autoAnswerConfidence: s.autoAnswerConfidence ?? 0.82,
    onboardingDismissed: s.onboardingDismissed ?? false,
  };
}
