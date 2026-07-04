import { eq, sql } from "drizzle-orm";
import { createOrg } from "../bootstrap.js";
import { db, tables } from "../db/index.js";
import { hashPassword } from "../lib/crypto.js";
import { getEmbeddingProvider } from "../providers/embeddings/index.js";
import type { SeedSummary } from "./demo.js";

/**
 * Demo dataset: "Fjord Logistics IT" — the org from the design mockups.
 * A believable snapshot of a knowledge loop mid-flight: open queue, threads,
 * captured resolutions, published + draft + stale articles, a merge proposal,
 * clusters with one documentation gap, notifications, and event history —
 * enough to exercise every screen on web and mobile.
 */

const now = Date.now();
const daysAgo = (d: number, h = 0) => new Date(now - d * 86_400_000 - h * 3_600_000);
const minutesLater = (t: Date, m: number) => new Date(t.getTime() + m * 60_000);

export async function seedFjord(): Promise<SeedSummary> {
  const org = await createOrg("Fjord Logistics IT");
  const password = "kloop-demo";

  // ---------------------------------------------------------------- users
  const mk = async (email: string, name: string, role: string) =>
    (
      await db
        .insert(tables.users)
        .values({ orgId: org.id, email, name, role, passwordHash: await hashPassword(password), lastSeenAt: daysAgo(0, 1) })
        .returning()
    )[0];

  const maya = await mk("maya@fjord.io", "Maya Chen", "supporter");
  const tomas = await mk("tomas@fjord.io", "Tomas Lind", "supporter");
  const admin = await mk("admin@fjord.io", "Alex Berg", "admin");
  const jonas = await mk("jonas.weber@fjord.io", "Jonas Weber", "requester");
  const priya = await mk("priya@fjord.io", "Priya Nair", "requester");
  const erik = await mk("erik@fjord.io", "Erik Dahl", "requester");

  // ---------------------------------------------------------------- articles
  type Block = { kind: "symptoms" | "environment" | "resolution" | "notes"; contentMd: string; conditionText?: string | null };
  const mkArticle = async (input: {
    kbNumber: number;
    title: string;
    summary: string;
    tags: string[];
    blocks: Block[];
    status?: "draft" | "published";
    createdByKind?: "ai" | "user";
    approvedBy?: string;
    confidence?: number;
    freshnessScore?: number;
    staleFlag?: boolean;
    staleReason?: string;
    helpfulCount?: number;
    notHelpfulCount?: number;
    viewCount?: number;
    solveCount?: number;
    createdAt?: Date;
    updatedAt?: Date;
  }) => {
    const [article] = await db
      .insert(tables.articles)
      .values({
        orgId: org.id,
        kbNumber: input.kbNumber,
        status: input.status ?? "published",
        tags: input.tags,
        confidence: input.confidence ?? 0.85,
        freshnessScore: input.freshnessScore ?? 0.95,
        staleFlag: input.staleFlag ?? false,
        staleReason: input.staleReason,
        helpfulCount: input.helpfulCount ?? 0,
        notHelpfulCount: input.notHelpfulCount ?? 0,
        viewCount: input.viewCount ?? 0,
        solveCount: input.solveCount ?? 0,
        createdAt: input.createdAt ?? daysAgo(45),
        updatedAt: input.updatedAt ?? daysAgo(9),
      })
      .returning();
    const [revision] = await db
      .insert(tables.articleRevisions)
      .values({
        orgId: org.id,
        articleId: article.id,
        title: input.title,
        summary: input.summary,
        createdByKind: input.createdByKind ?? "ai",
        approvedBy: input.approvedBy,
        changeNote: "initial revision",
        createdAt: input.createdAt ?? daysAgo(45),
      })
      .returning();
    const blocks = [];
    for (let i = 0; i < input.blocks.length; i++) {
      const b = input.blocks[i];
      blocks.push(
        (
          await db
            .insert(tables.articleBlocks)
            .values({
              orgId: org.id,
              articleId: article.id,
              revisionId: revision.id,
              kind: b.kind,
              position: i,
              conditionText: b.conditionText ?? null,
              contentMd: b.contentMd,
            })
            .returning()
        )[0],
      );
    }
    await db.update(tables.articles).set({ currentRevisionId: revision.id }).where(eq(tables.articles.id, article.id));
    return { article, revision, blocks };
  };

  const vpn = await mkArticle({
    kbNumber: 41,
    title: "VPN drops every few minutes on hotel or hotspot Wi-Fi",
    summary: "Captive-portal networks silently kill the tunnel. Re-select the profile and switch the protocol to IKEv2.",
    tags: ["vpn", "network", "remote-work"],
    blocks: [
      { kind: "symptoms", contentMd: "- VPN connects, then drops after 5–10 minutes\n- Happens on hotel, train, or phone-hotspot Wi-Fi\n- Office and home networks are fine" },
      { kind: "environment", contentMd: "- FjordVPN client 4.x on macOS and Windows\n- Any captive-portal network (hotel, airport, café)" },
      {
        kind: "resolution",
        contentMd: "1. Open the FjordVPN client and disconnect\n2. In **Settings → Protocol**, switch from *Auto* to **IKEv2**\n3. Re-select the **Fjord-Remote** profile from Self Service\n4. Reconnect — the tunnel should now survive the portal's idle checks",
      },
      { kind: "notes", contentMd: "If the portal page never appeared, open `neverssl.com` first to trigger it. Escalate to network team if IKEv2 is blocked outright." },
    ],
    approvedBy: maya.id,
    confidence: 0.93,
    freshnessScore: 0.92,
    helpfulCount: 12,
    notHelpfulCount: 1,
    viewCount: 148,
    solveCount: 14,
    createdAt: daysAgo(52),
    updatedAt: daysAgo(11),
  });

  const printer = await mkArticle({
    kbNumber: 32,
    title: "Printer shows offline after a macOS update",
    summary: "macOS updates reset the print system's trust of the driver. Removing and re-adding the queue fixes it.",
    tags: ["printer", "macos"],
    blocks: [
      { kind: "symptoms", contentMd: "- Printer worked yesterday, shows **offline** today\n- A macOS update was installed recently\n- Other people can print to the same device" },
      { kind: "resolution", contentMd: "1. **System Settings → Printers & Scanners**\n2. Remove the affected printer queue\n3. Click **Add Printer** and re-select it (it advertises via AirPrint)\n4. Print a test page" },
      { kind: "notes", contentMd: "Happens after most major macOS point releases. No driver reinstall needed since we moved to AirPrint." },
    ],
    approvedBy: tomas.id,
    confidence: 0.88,
    freshnessScore: 0.9,
    helpfulCount: 8,
    notHelpfulCount: 0,
    viewCount: 74,
    solveCount: 9,
    createdAt: daysAgo(60),
    updatedAt: daysAgo(20),
  });

  const printerSleep = await mkArticle({
    kbNumber: 36,
    title: "Printer offline after Mac wakes from sleep",
    summary: "After waking from sleep the print queue sometimes stays paused. Resume the queue or re-add the printer.",
    tags: ["printer", "macos"],
    blocks: [
      { kind: "symptoms", contentMd: "- Printer shows offline only after the Mac wakes from sleep\n- Rebooting fixes it temporarily" },
      { kind: "resolution", contentMd: "1. Open the print queue from the Dock\n2. Click **Resume** if the queue is paused\n3. If it stays offline: remove and re-add the printer in **Printers & Scanners**" },
    ],
    approvedBy: maya.id,
    confidence: 0.72,
    freshnessScore: 0.85,
    helpfulCount: 3,
    notHelpfulCount: 1,
    viewCount: 31,
    solveCount: 3,
    createdAt: daysAgo(38),
    updatedAt: daysAgo(24),
  });

  const mailbox = await mkArticle({
    kbNumber: 27,
    title: "Shared mailbox missing in Outlook",
    summary: "Group membership drives shared mailbox mapping; it takes up to an hour after being added.",
    tags: ["email", "outlook"],
    blocks: [
      { kind: "symptoms", contentMd: "- A shared mailbox (e.g. `support@fjord.io`) does not appear in Outlook's sidebar" },
      { kind: "resolution", contentMd: "1. Confirm membership of the matching **M365 group** (ask your lead or IT)\n2. Wait up to 60 minutes — mapping is automatic\n3. Still missing? **File → Account Settings → Change → More Settings → Advanced → Add** the mailbox manually" },
      { kind: "notes", contentMd: "Manual adds bypass automapping and won't survive profile rebuilds — prefer fixing group membership." },
    ],
    approvedBy: maya.id,
    confidence: 0.86,
    freshnessScore: 0.93,
    helpfulCount: 6,
    notHelpfulCount: 1,
    viewCount: 52,
    solveCount: 6,
    createdAt: daysAgo(70),
    updatedAt: daysAgo(30),
  });

  const scannerReset = await mkArticle({
    kbNumber: 18,
    title: "Password reset for warehouse scanner terminals",
    summary: "Scanner terminals authenticate against the warehouse AD; resets happen at the terminal, not the portal.",
    tags: ["scanner", "warehouse"],
    blocks: [
      { kind: "symptoms", contentMd: "- Scanner gun shows *invalid credentials* after a password change" },
      { kind: "resolution", contentMd: "1. On the terminal, press **Menu → Sign out**\n2. Sign in with the *new* AD password\n3. If it loops, hold the power button 10s to restart the terminal" },
    ],
    approvedBy: tomas.id,
    confidence: 0.61,
    freshnessScore: 0.34,
    staleFlag: true,
    staleReason: "3 recent resolutions used a different procedure (portal-based reset, rolled out in June)",
    helpfulCount: 4,
    notHelpfulCount: 3,
    viewCount: 66,
    solveCount: 5,
    createdAt: daysAgo(140),
    updatedAt: daysAgo(96),
  });

  // draft awaiting review (generated by the article-gen worker)
  const mfaDraft = await mkArticle({
    kbNumber: 44,
    title: "MFA prompt loop when switching networks",
    summary: "Switching between office Wi-Fi and VPN mid-session invalidates the token cache; clearing it stops the loop.",
    tags: ["mfa", "auth"],
    status: "draft",
    createdByKind: "ai",
    confidence: 0.83,
    blocks: [
      { kind: "symptoms", contentMd: "- Authenticator prompts repeat every few minutes\n- Started after switching between office Wi-Fi and VPN" },
      { kind: "environment", contentMd: "- Company portal / M365 apps on laptops\n- Seen on both macOS and Windows" },
      {
        kind: "resolution",
        contentMd: "1. Sign out of the company portal completely\n2. Clear the token cache: **Settings → Accounts → Access work or school → Disconnect/Reconnect** (Windows) or Keychain → delete `com.microsoft.workplacejoin` entries (macOS)\n3. Sign back in once, approve a single MFA prompt\n4. Stay on one network for the first 10 minutes",
      },
    ],
    createdAt: daysAgo(1, 3),
    updatedAt: daysAgo(1, 3),
  });

  // ---------------------------------------------------------------- requests + threads + resolutions
  let ref = 1300;
  const mkRequest = async (input: {
    author: typeof jonas;
    title: string;
    body?: string;
    tags?: string[];
    channel?: string;
    status?: string;
    claimedBy?: string;
    createdAt: Date;
    solvedAfterMin?: number;
    confirmationState?: string;
    autoAnswered?: boolean;
    escalated?: boolean;
    selfSolvedArticleId?: string;
    unreadForRequester?: boolean;
    unreadForSupporter?: boolean;
    satisfaction?: number;
  }) => {
    ref += 1;
    const solvedAt = input.solvedAfterMin != null ? minutesLater(input.createdAt, input.solvedAfterMin) : null;
    const [row] = await db
      .insert(tables.requests)
      .values({
        orgId: org.id,
        refNumber: ref,
        authorId: input.author.id,
        title: input.title,
        body: input.body ?? "",
        status: input.status ?? (solvedAt ? "solved" : "open"),
        channel: input.channel ?? "web",
        tags: input.tags ?? [],
        claimedBy: input.claimedBy,
        claimedAt: input.claimedBy ? minutesLater(input.createdAt, 6) : null,
        solvedAt,
        selfSolvedArticleId: input.selfSolvedArticleId,
        autoAnswered: input.autoAnswered ?? false,
        escalated: input.escalated ?? false,
        confirmationState: input.confirmationState ?? (solvedAt ? "confirmed" : "none"),
        satisfaction: input.satisfaction,
        unreadForRequester: input.unreadForRequester ?? false,
        unreadForSupporter: input.unreadForSupporter ?? !solvedAt,
        createdAt: input.createdAt,
        updatedAt: solvedAt ?? input.createdAt,
        lastActivityAt: solvedAt ?? minutesLater(input.createdAt, 30),
      })
      .returning();
    return row;
  };

  const say = async (req: typeof tables.requests.$inferSelect, author: { id: string } | null, body: string, opts?: { kind?: string; articleId?: string; fromAiDraft?: boolean; at?: Date }) => {
    await db.insert(tables.messages).values({
      orgId: org.id,
      requestId: req.id,
      authorId: author?.id ?? null,
      kind: opts?.kind ?? "message",
      body,
      articleId: opts?.articleId,
      fromAiDraft: opts?.fromAiDraft ?? false,
      createdAt: opts?.at ?? minutesLater(req.createdAt, 10),
    });
  };

  const capture = async (
    req: typeof tables.requests.$inferSelect,
    supporter: { id: string },
    raw: string,
    summary: string,
    opts?: { captureKind?: string; trusted?: boolean; articleId?: string; linkedResolutionId?: string },
  ) => {
    const [res] = await db
      .insert(tables.resolutions)
      .values({
        orgId: org.id,
        requestId: req.id,
        supporterId: supporter.id,
        rawCaptureText: raw,
        captureKind: opts?.captureKind ?? "text",
        structuredSummary: summary,
        trusted: opts?.trusted ?? true,
        articleId: opts?.articleId,
        linkedResolutionId: opts?.linkedResolutionId,
        createdAt: req.solvedAt ?? minutesLater(req.createdAt, 25),
      })
      .returning();
    return res;
  };

  // --- solved history (feeds trend chart, precedents, provenance) ---------
  const vpnSolved1 = await mkRequest({
    author: jonas, title: "VPN keeps dropping at the hotel in Bergen", body: "Connects fine, dies after ~10 minutes. Hotel Wi-Fi.",
    tags: ["vpn"], createdAt: daysAgo(49, 4), solvedAfterMin: 34, claimedBy: maya.id, satisfaction: 5,
  });
  const res1 = await capture(vpnSolved1, maya, "switched protocol to ikev2, re-added the remote profile from self service", "Switched VPN protocol to IKEv2 and re-selected the Fjord-Remote profile.", { articleId: vpn.article.id });
  await say(vpnSolved1, jonas, "Connects fine, but drops every ten minutes or so. I'm at a hotel in Bergen.", { at: minutesLater(vpnSolved1.createdAt, 1) });
  await say(vpnSolved1, maya, "That's the captive portal killing the tunnel — switch the protocol to IKEv2 in the client settings and re-add the Fjord-Remote profile. Takes two minutes.", { at: minutesLater(vpnSolved1.createdAt, 12) });

  const vpnSolved2 = await mkRequest({
    author: priya, title: "VPN unstable on train hotspot", body: "Using my phone hotspot on the train, VPN reconnects constantly.",
    tags: ["vpn"], createdAt: daysAgo(33, 2), solvedAfterMin: 21, claimedBy: tomas.id, satisfaction: 4,
  });
  const res2 = await capture(vpnSolved2, tomas, "same as bergen hotel case — ikev2 fix", "Same as REQ-1301: forced IKEv2 protocol, tunnel stable afterwards.", { articleId: vpn.article.id, linkedResolutionId: res1.id });

  const vpnSolved3 = await mkRequest({
    author: erik, title: "Remote VPN disconnects from café wifi", tags: ["vpn"],
    createdAt: daysAgo(19, 6), solvedAfterMin: 18, claimedBy: maya.id, satisfaction: 5,
  });
  await capture(vpnSolved3, maya, "ikev2 + re-select profile, told them about neverssl trick", "IKEv2 protocol switch; opened neverssl.com to trigger the captive portal first.", { articleId: vpn.article.id, linkedResolutionId: res1.id });

  const printerSolved = await mkRequest({
    author: priya, title: "Office printer offline since yesterday's update", tags: ["printer"],
    createdAt: daysAgo(26, 3), solvedAfterMin: 15, claimedBy: tomas.id, satisfaction: 5,
  });
  await capture(printerSolved, tomas, "removed + re-added queue after sonoma update", "Removed and re-added the printer queue after the macOS update reset the print system.", { articleId: printer.article.id });

  const mailboxSolved = await mkRequest({
    author: jonas, title: "Can't see the support@ shared mailbox", tags: ["email"],
    createdAt: daysAgo(15, 5), solvedAfterMin: 42, claimedBy: maya.id, satisfaction: 4,
  });
  await capture(mailboxSolved, maya, "added him to the m365 group, mapped within the hour", "Added requester to the support M365 group; automapping restored the mailbox.", { articleId: mailbox.article.id });

  // MFA cases that fed the KB-044 draft
  const mfa1 = await mkRequest({
    author: erik, title: "Authenticator keeps prompting me every few minutes", tags: ["mfa"],
    createdAt: daysAgo(6, 8), solvedAfterMin: 55, claimedBy: maya.id, satisfaction: 4,
  });
  const mfaRes1 = await capture(mfa1, maya, "voice note: cleared workplace join tokens from keychain, single re-auth, told him to stay on one network", "Cleared the workplace-join token cache and re-authenticated once.", { captureKind: "voice" });
  const mfa2 = await mkRequest({
    author: priya, title: "MFA loop after switching from wifi to VPN", tags: ["mfa"],
    createdAt: daysAgo(4, 6), solvedAfterMin: 38, claimedBy: tomas.id, satisfaction: 5,
  });
  const mfaRes2 = await capture(mfa2, tomas, "same token-cache clear as erik's case", "Token cache clear (same as REQ-1306); advised staying on one network for 10 minutes.", { linkedResolutionId: mfaRes1.id });
  const mfa3 = await mkRequest({
    author: jonas, title: "Endless MFA prompts on the road", tags: ["mfa"],
    createdAt: daysAgo(2, 9), solvedAfterMin: 26, claimedBy: maya.id, satisfaction: 5,
  });
  const mfaRes3 = await capture(mfa3, maya, "cache clear + reconnect, 3rd one this week — needs an article", "Token cache clear; third occurrence this week.", { linkedResolutionId: mfaRes1.id });

  // deflection wins
  const selfSolved = await mkRequest({
    author: erik, title: "vpn dies on hotel wifi again", channel: "mobile", tags: ["vpn"],
    createdAt: daysAgo(9, 2), solvedAfterMin: 2, selfSolvedArticleId: vpn.article.id, confirmationState: "confirmed",
  });
  const autoSolved = await mkRequest({
    author: priya, title: "Printer says offline after the update", channel: "web", tags: ["printer"],
    createdAt: daysAgo(7, 5), solvedAfterMin: 65, autoAnswered: true, confirmationState: "confirmed", satisfaction: 4,
  });
  await say(autoSolved, null, "It looks like the recent macOS update reset your print system. Remove the printer in System Settings → Printers & Scanners, add it again, and print a test page. Did this solve your problem?", { kind: "auto_answer", articleId: printer.article.id, at: minutesLater(autoSolved.createdAt, 1) });
  await say(autoSolved, null, "Priya confirmed the fix. Request closed automatically.", { kind: "system", at: minutesLater(autoSolved.createdAt, 64) });

  // scanner gap cluster — recurring, undocumented
  const scannerReqs = [];
  for (const [i, [author, title]] of (
    [
      [jonas, "Scanner gun battery dead by morning shift"],
      [priya, "Warehouse scanner won't hold charge overnight"],
      [erik, "Zebra scanner drained again — second time this week"],
      [jonas, "Scanner 14 completely flat at 6am"],
    ] as const
  ).entries()) {
    const solved = i < 3;
    scannerReqs.push(
      await mkRequest({
        author, title, tags: ["scanner", "warehouse"],
        createdAt: daysAgo(21 - i * 5, 3),
        ...(solved ? { solvedAfterMin: 70 + i * 15, claimedBy: i % 2 === 0 ? tomas.id : maya.id } : { status: "open", unreadForSupporter: true }),
      }),
    );
  }
  await capture(scannerReqs[0], tomas, "swapped battery, old one wouldn't hold charge. cradle contacts dirty too", "Replaced battery and cleaned cradle contacts.", {});
  await capture(scannerReqs[1], maya, "another dead battery. charging cradle in bay 3 seems flaky", "Battery replaced; charging cradle in bay 3 suspected faulty.", {});
  await capture(scannerReqs[2], tomas, "cradle 3 confirmed dead, moved to cradle 5", "Moved device to a working cradle; cradle 3 flagged for replacement.", {});

  // --- the live queue -----------------------------------------------------
  const openWifi = await mkRequest({
    author: jonas, title: "Cannot connect to warehouse Wi-Fi since this morning", body: "Laptop sees the network but authentication fails. Phone connects fine.",
    tags: ["network"], createdAt: daysAgo(0, 2), status: "open", unreadForSupporter: true,
  });
  await say(openWifi, jonas, "Laptop sees FJORD-WH but auth fails since ~7am. My phone connects fine. Tried forget + rejoin.", { at: minutesLater(openWifi.createdAt, 1) });

  const openEmail = await mkRequest({
    author: priya, title: "Fwd: scanner gun won't sync orders", body: "Forwarded from warehouse floor — scanner 12 stuck on 'sync pending' since the shift started.",
    tags: ["scanner", "warehouse"], channel: "email", createdAt: daysAgo(0, 5), status: "open", unreadForSupporter: true,
  });

  const escalated = await mkRequest({
    author: erik, title: "VPN still dropping — the suggested fix didn't help", body: "Tried the IKEv2 switch from the article, still drops every few minutes.",
    tags: ["vpn"], createdAt: daysAgo(0, 8), status: "open", autoAnswered: true, escalated: true, unreadForSupporter: true,
  });
  await say(escalated, null, "This looks like the captive-portal issue from KB-041. Switch the protocol to IKEv2 in the FjordVPN client and re-select the Fjord-Remote profile. Did this solve your problem?", { kind: "auto_answer", articleId: vpn.article.id, at: minutesLater(escalated.createdAt, 1) });
  await say(escalated, null, "Erik reported the suggestion didn't help. Escalated to the queue.", { kind: "system", at: minutesLater(escalated.createdAt, 30) });
  await say(escalated, erik, "Tried the IKEv2 switch, no change. This is my apartment Wi-Fi though, not a hotel.", { at: minutesLater(escalated.createdAt, 32) });

  const handledOutlook = await mkRequest({
    author: priya, title: "Outlook keeps asking for my password", body: "Started after the password change yesterday. Entering the right one doesn't stick.",
    tags: ["email", "outlook"], createdAt: daysAgo(1, 4), status: "handled", claimedBy: maya.id, confirmationState: "pending", unreadForRequester: true, unreadForSupporter: false,
  });
  await say(handledOutlook, priya, "Changed my password yesterday and now Outlook prompts on every launch. The web version works.", { at: minutesLater(handledOutlook.createdAt, 2) });
  await say(handledOutlook, maya, "Keychain is probably holding the old credential.", { kind: "internal_note", at: minutesLater(handledOutlook.createdAt, 20) });
  await say(handledOutlook, maya, "Hi Priya — that's the old password stuck in the keychain. Open Keychain Access, search for 'Exchange', delete those entries, then restart Outlook and sign in once. Can you tell me if that stops the prompts?", { fromAiDraft: true, at: minutesLater(handledOutlook.createdAt, 24) });
  await capture(handledOutlook, maya, "stale exchange creds in keychain after pw change — deleted, one clean sign-in", "Removed stale Exchange credentials from the keychain after a password change.", { trusted: false });

  const handledProjector = await mkRequest({
    author: jonas, title: "Projector in Oslo meeting room shows no signal", tags: ["av", "meeting-room"],
    createdAt: daysAgo(0, 26), status: "handled", claimedBy: tomas.id, unreadForSupporter: false,
  });
  await say(handledProjector, jonas, "Big meeting at 14:00 — the Oslo room projector says no signal on HDMI 1.", { at: minutesLater(handledProjector.createdAt, 1) });
  await say(handledProjector, tomas, "On it — checking whether the switcher lost its input mapping again.", { at: minutesLater(handledProjector.createdAt, 15) });

  // ---------------------------------------------------------------- clusters
  const mkCluster = async (label: string, articleId: string | null, reqs: (typeof tables.requests.$inferSelect)[], minutes: number) => {
    const [cluster] = await db
      .insert(tables.clusters)
      .values({
        orgId: org.id,
        label,
        articleId,
        requestCount: reqs.length,
        totalMinutesSpent: minutes,
        lastRequestAt: reqs.map((r) => r.createdAt).sort((a, b) => b.getTime() - a.getTime())[0],
        createdAt: daysAgo(50),
        updatedAt: daysAgo(0, 6),
      })
      .returning();
    for (const r of reqs) await db.update(tables.requests).set({ clusterId: cluster.id }).where(eq(tables.requests.id, r.id));
    return cluster;
  };

  await mkCluster("VPN drops on portal Wi-Fi", vpn.article.id, [vpnSolved1, vpnSolved2, vpnSolved3, selfSolved, escalated], 210);
  await mkCluster("Printer offline after macOS updates", printer.article.id, [printerSolved, autoSolved], 80);
  await mkCluster("MFA prompt loops", null, [mfa1, mfa2, mfa3], 119);
  const gapCluster = await mkCluster("Warehouse scanner batteries drain overnight", null, scannerReqs, 265);

  // ---------------------------------------------------------------- provenance
  const provFor = async (blocks: (typeof tables.articleBlocks.$inferSelect)[], kind: "symptoms" | "resolution", sources: { kind: "request" | "resolution"; id: string }[]) => {
    const block = blocks.find((b) => b.kind === kind);
    if (block) await db.insert(tables.provenance).values(sources.map((s) => ({ articleBlockId: block.id, sourceKind: s.kind, sourceId: s.id })));
  };
  await provFor(vpn.blocks, "resolution", [
    { kind: "resolution", id: res1.id },
    { kind: "resolution", id: res2.id },
  ]);
  await provFor(vpn.blocks, "symptoms", [{ kind: "request", id: vpnSolved1.id }]);
  await provFor(mfaDraft.blocks, "resolution", [
    { kind: "resolution", id: mfaRes1.id },
    { kind: "resolution", id: mfaRes2.id },
    { kind: "resolution", id: mfaRes3.id },
  ]);
  await provFor(mfaDraft.blocks, "symptoms", [
    { kind: "request", id: mfa1.id },
    { kind: "request", id: mfa2.id },
  ]);

  // ---------------------------------------------------------------- review inbox
  // 1) new draft
  await db.insert(tables.reviewItems).values({
    orgId: org.id,
    kind: "draft",
    articleId: mfaDraft.article.id,
    revisionId: mfaDraft.revision.id,
    confidence: 0.83,
    context: "From 3 resolutions · Maya, Tomas",
    createdAt: daysAgo(1, 3),
  });

  // 2) proposed update to KB-041 (new revision, NOT current)
  const [updateRev] = await db
    .insert(tables.articleRevisions)
    .values({
      orgId: org.id,
      articleId: vpn.article.id,
      title: "VPN drops every few minutes on hotel or hotspot Wi-Fi",
      summary: "Captive-portal networks silently kill the tunnel. Re-select the profile and switch the protocol to IKEv2.",
      createdByKind: "ai",
      parentRevisionId: vpn.revision.id,
      changeNote: "Adds the home-router MTU case from REQ-1313 — IKEv2 alone doesn't fix non-portal networks",
      createdAt: daysAgo(0, 4),
    })
    .returning();
  const updateBlocks: Block[] = [
    { kind: "symptoms", contentMd: "- VPN connects, then drops after 5–10 minutes\n- Happens on hotel, train, or phone-hotspot Wi-Fi\n- **Also seen on some home routers with small MTU values**" },
    { kind: "environment", contentMd: "- FjordVPN client 4.x on macOS and Windows\n- Any captive-portal network (hotel, airport, café)\n- Home routers with PPPoE (MTU 1492 or lower)" },
    {
      kind: "resolution",
      contentMd: "1. Open the FjordVPN client and disconnect\n2. In **Settings → Protocol**, switch from *Auto* to **IKEv2**\n3. Re-select the **Fjord-Remote** profile from Self Service\n4. Reconnect — the tunnel should now survive the portal's idle checks",
    },
    {
      kind: "resolution",
      conditionText: "Home network, not a captive portal",
      contentMd: "1. In the client, open **Settings → Advanced**\n2. Set **MTU** to `1360`\n3. Reconnect — fixes drops on PPPoE home routers",
    },
    { kind: "notes", contentMd: "If the portal page never appeared, open `neverssl.com` first to trigger it. Escalate to network team if IKEv2 is blocked outright." },
  ];
  for (let i = 0; i < updateBlocks.length; i++) {
    const b = updateBlocks[i];
    await db.insert(tables.articleBlocks).values({
      orgId: org.id,
      articleId: vpn.article.id,
      revisionId: updateRev.id,
      kind: b.kind,
      position: i,
      conditionText: b.conditionText ?? null,
      contentMd: b.contentMd,
    });
  }
  await db.insert(tables.reviewItems).values({
    orgId: org.id,
    kind: "update",
    articleId: vpn.article.id,
    revisionId: updateRev.id,
    confidence: 0.74,
    context: "New resolution contradicts step coverage — home-router MTU case",
    createdAt: daysAgo(0, 4),
  });

  // 3) merge proposal: KB-032 + KB-036
  const [mergeCandidate] = await db
    .insert(tables.mergeCandidates)
    .values({
      orgId: org.id,
      articleAId: printer.article.id,
      articleBId: printerSleep.article.id,
      scores: { simSummary: 0.87, simSymptoms: 0.81, simResolution: 0.78, clusterOverlap: 0.5, coRetrieval: 0.64, entityOverlap: 0.67 },
      compositeScore: 0.78,
      verdict: "merge",
      proposal: {
        rationale:
          "Both articles describe the same underlying failure — the macOS print system losing the queue — triggered by an update in one case and sleep/wake in the other. Resolutions overlap almost entirely; the sleep case only adds the 'resume queue' first step.",
        confidence: 0.86,
        mergedTitle: "Printer shows offline on macOS (after updates or sleep)",
        mergedSummary: "macOS updates and sleep/wake cycles can stall or reset the print queue. Resume the queue, or remove and re-add the printer.",
        blocks: [
          { kind: "symptoms", contentMd: "- Printer shows **offline** while others can print to it\n- Often right after a macOS update or after waking from sleep", origin: "merged" },
          { kind: "resolution", conditionText: "After waking from sleep", contentMd: "1. Open the print queue from the Dock\n2. Click **Resume** if the queue is paused", origin: "KB-036" },
          { kind: "resolution", conditionText: "After a macOS update, or resume didn't help", contentMd: "1. **System Settings → Printers & Scanners**\n2. Remove the affected printer queue\n3. **Add Printer** and re-select it (AirPrint)\n4. Print a test page", origin: "KB-032" },
          { kind: "notes", contentMd: "No driver reinstall needed since the AirPrint migration.", origin: "KB-032" },
        ],
        diff: [
          { op: "keep", blockKind: "symptoms", from: "KB-032" },
          { op: "add-conditioned", blockKind: "resolution", from: "KB-036" },
          { op: "keep-conditioned", blockKind: "resolution", from: "KB-032" },
        ],
      },
      createdAt: daysAgo(2, 1),
    })
    .returning();
  await db.insert(tables.reviewItems).values({
    orgId: org.id,
    kind: "merge",
    mergeCandidateId: mergeCandidate.id,
    articleId: printer.article.id,
    confidence: 0.78,
    context: "KB-032 + KB-036 · same fix, different trigger",
    createdAt: daysAgo(2, 1),
  });

  // 4) stale flag on the scanner-reset article
  await db.insert(tables.reviewItems).values({
    orgId: org.id,
    kind: "stale",
    articleId: scannerReset.article.id,
    confidence: 0.66,
    context: "Feedback trend negative · procedure changed in June",
    createdAt: daysAgo(3, 2),
  });

  // ---------------------------------------------------------------- notifications
  await db.insert(tables.notifications).values([
    {
      orgId: org.id, userId: priya.id, type: "reply",
      title: "Maya replied to your request", body: "That's the old password stuck in the keychain…",
      linkPath: `/requests/${handledOutlook.id}`, createdAt: minutesLater(handledOutlook.createdAt, 24),
    },
    {
      orgId: org.id, userId: maya.id, type: "review_item",
      title: "New article draft ready for review", body: "MFA prompt loop when switching networks — from 3 resolutions",
      linkPath: "/reviews", createdAt: daysAgo(1, 3),
    },
    {
      orgId: org.id, userId: tomas.id, type: "review_item",
      title: "Merge proposal: KB-032 + KB-036", body: "Same fix, different trigger — 78% composite similarity",
      linkPath: "/reviews", createdAt: daysAgo(2, 1),
    },
    {
      orgId: org.id, userId: jonas.id, type: "status_change",
      title: "Your request was solved", body: "Can't see the support@ shared mailbox — confirmed fixed",
      linkPath: `/requests/${mailboxSolved.id}`, readAt: daysAgo(14), createdAt: daysAgo(15, 4),
    },
  ]);

  // ---------------------------------------------------------------- events (insights + learning signals)
  const events: (typeof tables.events.$inferInsert)[] = [];
  const allReqs = await db.select().from(tables.requests).where(eq(tables.requests.orgId, org.id));
  for (const r of allReqs) {
    events.push({ orgId: org.id, actorKind: "user", actorId: r.authorId, type: "request_created", payload: { requestId: r.id }, createdAt: r.createdAt });
    if (r.solvedAt) events.push({ orgId: org.id, actorKind: r.autoAnswered || r.selfSolvedArticleId ? "ai" : "user", actorId: r.claimedBy, type: "request_solved", payload: { requestId: r.id }, createdAt: r.solvedAt });
  }
  events.push(
    { orgId: org.id, actorKind: "ai", type: "deflection_shown", payload: { requestDraft: "vpn dies on hotel wifi again", articleIds: [vpn.article.id] }, createdAt: selfSolved.createdAt },
    { orgId: org.id, actorKind: "user", actorId: erik.id, type: "deflection_accepted", payload: { articleId: vpn.article.id, requestId: selfSolved.id }, createdAt: minutesLater(selfSolved.createdAt, 2) },
    { orgId: org.id, actorKind: "ai", type: "auto_answer_sent", payload: { requestId: autoSolved.id, articleId: printer.article.id, similarity: 0.9 }, createdAt: minutesLater(autoSolved.createdAt, 1) },
    { orgId: org.id, actorKind: "ai", type: "auto_answer_sent", payload: { requestId: escalated.id, articleId: vpn.article.id, similarity: 0.87 }, createdAt: minutesLater(escalated.createdAt, 1) },
    // co-retrieval signal for the merge scan
    { orgId: org.id, actorKind: "user", actorId: maya.id, type: "search_results", payload: { q: "printer offline", articleIds: [printer.article.id, printerSleep.article.id] }, createdAt: daysAgo(5) },
    { orgId: org.id, actorKind: "user", actorId: tomas.id, type: "search_results", payload: { q: "printer offline after sleep", articleIds: [printer.article.id, printerSleep.article.id] }, createdAt: daysAgo(4) },
    { orgId: org.id, actorKind: "ai", type: "gap_detected", payload: { clusterId: gapCluster.id, label: gapCluster.label }, createdAt: daysAgo(1) },
  );
  await db.insert(tables.events).values(events);

  // ---------------------------------------------------------------- counters
  await db.update(tables.counters).set({ value: ref }).where(sql`org_id = ${org.id} and name = 'request'`);
  await db.update(tables.counters).set({ value: 44 }).where(sql`org_id = ${org.id} and name = 'article'`);

  // ---------------------------------------------------------------- embeddings (synchronous — workers may not be running)
  await embedEverything(org.id);

  const counts = {
    users: 6,
    requests: allReqs.length,
    articles: 6,
    resolutions: 10,
    clusters: 4,
    reviewItems: 4,
  };
  return {
    orgName: org.name,
    counts,
    logins: [
      { email: "maya@fjord.io", password },
      { email: "jonas.weber@fjord.io", password },
      { email: "admin@fjord.io", password },
    ],
  };
}

/** Embed all pending rows in one pass so seeded data is searchable immediately. */
async function embedEverything(orgId: string): Promise<void> {
  const provider = getEmbeddingProvider();

  const embedBatch = async (
    rows: { id: string; text: string }[],
    table: typeof tables.requests | typeof tables.resolutions | typeof tables.articles | typeof tables.articleBlocks | typeof tables.messages,
    withModel: boolean,
  ) => {
    const nonEmpty = rows.filter((r) => r.text.trim());
    if (nonEmpty.length === 0) return;
    const vecs = await provider.embed(nonEmpty.map((r) => r.text), { orgId, purpose: "seed" });
    for (let i = 0; i < nonEmpty.length; i++) {
      await db
        .update(table)
        .set({ embedding: vecs[i], embeddingStatus: "ok", ...(withModel ? { embeddingModel: provider.model } : {}) })
        .where(eq(table.id, nonEmpty[i].id));
    }
  };

  const reqs = await db.select().from(tables.requests).where(eq(tables.requests.orgId, orgId));
  await embedBatch(reqs.map((r) => ({ id: r.id, text: `${r.title}\n${r.body}` })), tables.requests, true);

  const resolutions = await db.select().from(tables.resolutions).where(eq(tables.resolutions.orgId, orgId));
  await embedBatch(resolutions.map((r) => ({ id: r.id, text: `${r.structuredSummary ?? ""}\n${r.rawCaptureText}` })), tables.resolutions, false);

  const articles = await db.select().from(tables.articles).where(eq(tables.articles.orgId, orgId));
  const revs = await db.select().from(tables.articleRevisions).where(eq(tables.articleRevisions.orgId, orgId));
  const revById = Object.fromEntries(revs.map((r) => [r.id, r]));
  await embedBatch(
    articles
      .filter((a) => a.currentRevisionId)
      .map((a) => {
        const rev = revById[a.currentRevisionId!];
        return { id: a.id, text: rev ? `${rev.title}\n${rev.summary}` : "" };
      }),
    tables.articles,
    true,
  );

  const blocks = await db.select().from(tables.articleBlocks).where(eq(tables.articleBlocks.orgId, orgId));
  await embedBatch(blocks.map((b) => ({ id: b.id, text: `${b.conditionText ?? ""}\n${b.contentMd}` })), tables.articleBlocks, false);

  const messages = await db.select().from(tables.messages).where(eq(tables.messages.orgId, orgId));
  await embedBatch(messages.map((m) => ({ id: m.id, text: m.body })), tables.messages, false);

  // centroids = mean of member request embeddings
  const clusters = await db.select().from(tables.clusters).where(eq(tables.clusters.orgId, orgId));
  for (const cluster of clusters) {
    const members = reqs.filter((r) => r.clusterId === cluster.id);
    const fresh = await db.select().from(tables.requests).where(eq(tables.requests.clusterId, cluster.id));
    const vectors = fresh.map((r) => r.embedding as number[] | null).filter((v): v is number[] => Array.isArray(v));
    if (vectors.length === 0 || members.length === 0) continue;
    const dim = vectors[0].length;
    const centroid = new Array<number>(dim).fill(0);
    for (const v of vectors) for (let i = 0; i < dim; i++) centroid[i] += v[i] / vectors.length;
    await db.update(tables.clusters).set({ centroid }).where(eq(tables.clusters.id, cluster.id));
  }
}
