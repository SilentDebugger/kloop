import { getBoss } from "./boss.js";
import { logger } from "../lib/logger.js";

export const QUEUES = {
  embed: "embed",
  structure: "structure",
  articleGen: "article-gen",
  clusterScan: "cluster-scan",
  mergeScan: "merge-scan",
  freshnessScan: "freshness-scan",
  autoAnswer: "auto-answer",
  autoCloseScan: "auto-close-scan",
  autoTag: "auto-tag",
} as const;

export type EmbedJob = {
  kind: "request" | "resolution" | "article" | "article_block" | "message" | "attachment";
  id: string;
};

/** Fire-and-forget enqueue; a failed enqueue must never fail the request. */
export async function enqueue(queue: string, data: object, options?: { startAfterSeconds?: number }): Promise<void> {
  try {
    await getBoss().send(queue, data, {
      retryLimit: 3,
      retryDelay: 10,
      ...(options?.startAfterSeconds ? { startAfter: options.startAfterSeconds } : {}),
    });
  } catch (err) {
    logger.error("enqueue failed", { queue, err: String(err) });
  }
}

export async function enqueueEmbed(kind: EmbedJob["kind"], id: string): Promise<void> {
  await enqueue(QUEUES.embed, { kind, id } satisfies EmbedJob);
}
