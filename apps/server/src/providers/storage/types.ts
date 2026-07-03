/** Object storage abstraction: local disk -> MinIO -> S3 -> Supabase Storage. */
export interface StorageProvider {
  name: string;
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** URL a client can fetch the object from (signed for S3, API route for local). */
  url(key: string): Promise<string>;
}
