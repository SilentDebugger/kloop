import { config } from "../../config.js";
import type { StorageProvider } from "./types.js";
import { LocalStorageProvider } from "./local.js";
import { S3StorageProvider } from "./s3.js";

export type { StorageProvider } from "./types.js";

let instance: StorageProvider | null = null;

export function getStorage(): StorageProvider {
  if (instance) return instance;
  instance = config.STORAGE_DRIVER === "s3" ? new S3StorageProvider() : new LocalStorageProvider();
  return instance;
}
