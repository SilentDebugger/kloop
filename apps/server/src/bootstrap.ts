import { eq } from "drizzle-orm";
import { db, tables } from "./db/index.js";
import { hashPassword } from "./lib/crypto.js";
import { config } from "./config.js";

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "org"
  );
}

export function defaultOrgSettings(): Record<string, unknown> {
  return {
    automationTier: config.AUTOMATION_TIER,
    tagTierOverrides: {},
    authMethods: { magicLink: true, password: true, oidc: false },
    emailInEnabled: false,
    reopenGraceDays: 14,
    autoAnswerConfidence: 0.82,
  };
}

export async function createOrg(name: string): Promise<typeof tables.orgs.$inferSelect> {
  let slug = slugify(name);
  const existing = await db.query.orgs.findFirst({ where: eq(tables.orgs.slug, slug) });
  if (existing) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;

  const [org] = await db
    .insert(tables.orgs)
    .values({ name, slug, theme: { primary: "#2f7d5e", background: "#f7f5f0" }, settings: defaultOrgSettings() })
    .returning();

  await db.insert(tables.counters).values([
    { orgId: org.id, name: "request", value: 1000 },
    { orgId: org.id, name: "article", value: 0 },
  ]);
  return org;
}

export async function createAdmin(input: {
  orgName: string;
  email: string;
  name: string;
  password: string;
}): Promise<{
  org: typeof tables.orgs.$inferSelect;
  user: typeof tables.users.$inferSelect;
  loginUrl: string;
}> {
  if (!input.email.includes("@")) throw new Error("invalid email");
  if (input.password.length < 8) throw new Error("password must be at least 8 characters");

  const org = await createOrg(input.orgName);
  const [user] = await db
    .insert(tables.users)
    .values({
      orgId: org.id,
      email: input.email.toLowerCase(),
      name: input.name,
      role: "admin",
      passwordHash: await hashPassword(input.password),
    })
    .returning();

  return { org, user, loginUrl: config.PUBLIC_URL };
}
