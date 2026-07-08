import { eq } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { getLlmProvider, extractJson } from "../providers/llm/index.js";
import { threadTranscript } from "../lib/thread.js";
import { enqueue, enqueueEmbed, QUEUES } from "./queues.js";
import { bus } from "../realtime/bus.js";
import { logger } from "../lib/logger.js";

export type StructureJob = { resolutionId: string };

/**
 * "The system does the structuring, not the human." Raw capture (free text,
 * transcript, pasted commands) -> concise structured summary. Then the
 * resolution is embedded and considered for article generation.
 */
export async function handleStructureJob(job: StructureJob): Promise<void> {
  const resolution = await db.query.resolutions.findFirst({
    where: eq(tables.resolutions.id, job.resolutionId),
  });
  if (!resolution) return;

  // include attachment transcripts/OCR (voice memo captures)
  const atts = await db.query.attachments.findMany({
    where: eq(tables.attachments.ownerId, resolution.id),
  });
  const extraText = atts
    .filter((a) => a.ownerKind === "resolution" && a.extractedText)
    .map((a) => a.extractedText)
    .join("\n");

  const raw = `${resolution.rawCaptureText}\n${extraText}`.trim();
  let summary = resolution.structuredSummary;

  if (raw && !summary) {
    // full conversation as context — the capture is often terse ("reinstalled
    // the profile") and the thread carries the missing specifics
    const thread = await threadTranscript(resolution.requestId).catch(() => "");
    try {
      const out = await getLlmProvider().complete({
        system:
          'You clean up helpdesk resolution captures. Output strict JSON: {"summary": string (one sentence, what fixed it), "steps": string[] (imperative steps taken)}. ' +
          "The capture is the primary source; use the thread transcript only to fill in specifics (exact commands, settings, error codes) that the capture references. " +
          "Keep exact identifiers, commands and error codes verbatim. Do not invent steps.",
        prompt: JSON.stringify({ capture: raw.slice(0, 4000), thread }),
        json: true,
        orgId: resolution.orgId,
        task: "structure_capture",
        data: { raw, thread },
      });
      const parsed = extractJson<{ summary: string; steps: string[] }>(out);
      summary = [parsed.summary, ...(parsed.steps ?? []).map((s, i) => `${i + 1}. ${s}`)].join("\n");
    } catch (err) {
      logger.warn("structuring failed — keeping raw capture", { resolutionId: job.resolutionId, err: String(err) });
      summary = raw.slice(0, 500);
    }
  }

  await db
    .update(tables.resolutions)
    .set({ structuredSummary: summary })
    .where(eq(tables.resolutions.id, resolution.id));

  await enqueueEmbed("resolution", resolution.id);

  // Article generation is gated on the requester confirming the fix — an
  // unconfirmed resolution may turn out to be wrong ("not yet" reopens the
  // request), and a wrong fix must never seed a knowledge-base draft. Guest
  // requests auto-confirm at resolve time, so they proceed immediately;
  // everything else parks as waiting_confirmation and the confirm endpoint
  // enqueues generation once the requester says it's fixed.
  const request = await db.query.requests.findFirst({ where: eq(tables.requests.id, resolution.requestId) });
  if (request?.confirmationState === "confirmed") {
    // give the embedding a moment to land; article generation reads it via search
    await enqueue(QUEUES.articleGen, { resolutionId: resolution.id }, { startAfterSeconds: 6 });
  } else {
    await db
      .update(tables.resolutions)
      .set({ docState: "waiting_confirmation", docNote: "Waiting for the user to confirm the fix before writing this up." })
      .where(eq(tables.resolutions.id, resolution.id));
    bus.publish(resolution.orgId, {
      type: "ai_activity",
      supporterOnly: true,
      data: { resolutionId: resolution.id, requestId: resolution.requestId, state: "waiting_confirmation" },
    });
  }
}
