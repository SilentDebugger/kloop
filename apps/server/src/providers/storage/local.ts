import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { config } from "../../config.js";
import type { StorageProvider } from "./types.js";

/** Default driver: plain directory on disk (a docker volume in production). */
export class LocalStorageProvider implements StorageProvider {
  name = "local";
  private root = config.STORAGE_LOCAL_PATH;

  private resolve(key: string): string {
    const path = normalize(join(this.root, key));
    if (!path.startsWith(normalize(this.root))) throw new Error("invalid storage key");
    return path;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const path = this.resolve(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async url(key: string): Promise<string> {
    // Served by the attachments route, which enforces org membership.
    return `/api/files/${encodeURIComponent(key)}`;
  }
}
