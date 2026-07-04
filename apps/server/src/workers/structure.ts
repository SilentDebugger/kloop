import { eq } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { getLlmProvider, extractJson } from "../providers/llm/index.js";
import { enqueue, enqueueEmbed, QUEUES } from "./queues.js";
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
    try {
      const out = await getLlmProvider().complete({
        system:
          'You clean up helpdesk resolution captures. Output strict JSON: {"summary": string (one sentence, what fixed it), "steps": string[] (imperative steps taken)}. Keep exact identifiers, commands and error codes verbatim.',
        prompt: raw.slice(0, 4000),
        json: true,
        orgId: resolution.orgId,
        task: "structure_capture",
        data: { raw },
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
  // give the embedding a moment to land; article generation reads it via search
  await enqueue(QUEUES.articleGen, { resolutionId: resolution.id }, { startAfterSeconds: 6 });
}
