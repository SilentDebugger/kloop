import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../../config.js";
import type { StorageProvider } from "./types.js";

/** S3-compatible driver: AWS S3, MinIO, Supabase Storage (S3 protocol), R2, ... */
export class S3StorageProvider implements StorageProvider {
  name = "s3";
  private client = new S3Client({
    region: config.STORAGE_S3_REGION,
    ...(config.STORAGE_S3_ENDPOINT ? { endpoint: config.STORAGE_S3_ENDPOINT } : {}),
    forcePathStyle: config.STORAGE_S3_FORCE_PATH_STYLE,
    credentials:
      config.STORAGE_S3_ACCESS_KEY && config.STORAGE_S3_SECRET_KEY
        ? { accessKeyId: config.STORAGE_S3_ACCESS_KEY, secretAccessKey: config.STORAGE_S3_SECRET_KEY }
        : undefined,
  });
  private bucket = config.STORAGE_S3_BUCKET;

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: contentType }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const bytes = await res.Body?.transformToByteArray();
    if (!bytes) throw new Error(`s3 object ${key} has no body`);
    return Buffer.from(bytes);
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async url(key: string): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: 3600,
    });
  }
}
