import { EventEmitter } from "node:events";

/**
 * In-process realtime bus feeding the SSE streams. kloop ships as a single
 * container, so in-process pub/sub is exact; a multi-instance deployment
 * would swap this for Postgres LISTEN/NOTIFY behind the same interface.
 */
export type BusEvent = {
  type: string; // request_created | request_updated | message_created | review_changed | notification | ...
  data: Record<string, unknown>;
  /** restrict delivery to one user (e.g. personal notifications) */
  userId?: string;
  /** restrict delivery to supporters/admins (e.g. queue updates, internal notes) */
  supporterOnly?: boolean;
};

class RealtimeBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(10_000);
  }

  publish(orgId: string, event: BusEvent): void {
    this.emitter.emit(`org:${orgId}`, event);
  }

  subscribe(orgId: string, listener: (event: BusEvent) => void): () => void {
    const channel = `org:${orgId}`;
    this.emitter.on(channel, listener);
    return () => this.emitter.off(channel, listener);
  }
}

export const bus = new RealtimeBus();
