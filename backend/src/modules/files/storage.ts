import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  BucketAlreadyOwnedByYou,
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AppConfig } from '../../core/config';

export interface StagedObject {
  size: number;
  sha256: string;
  etag: string;
}

/**
 * Private object storage. Clients upload to a staging key through a short-lived link; COAL then
 * checks the bytes and copies them to the final key, which no client link can write to. Files
 * are read only through short-lived links (docs/architecture.md#security-basics).
 */
export interface FileStorage {
  uploadUrl(
    key: string,
    options: { contentType: string; size: number; seconds: number },
  ): Promise<{ url: string; headers: Record<string, string> }>;
  /** Reads a staged upload once, counting and hashing it. Stops reading past `maxBytes`. */
  inspect(key: string, maxBytes: number): Promise<StagedObject | 'missing' | 'too_large'>;
  /** Copies exactly the inspected bytes (checked by ETag) to the final key, then drops the staged copy. */
  promote(stagingKey: string, finalKey: string, etag: string, contentType: string): Promise<void>;
  downloadUrl(key: string, fileName: string, seconds: number): Promise<string>;
  /** Writes bytes COAL made itself (a PDF) straight to a final key. */
  write(key: string, bytes: Buffer, contentType: string): Promise<{ size: number; sha256: string }>;
  /** Reads a stored file, for COAL's own use: filling a template, scanning. */
  read(key: string): Promise<Buffer>;
  stream(key: string): Promise<Readable>;
}

const statusOf = (error: unknown) =>
  error instanceof S3ServiceException ? error.$metadata.httpStatusCode : undefined;

export class S3FileStorage implements FileStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: AppConfig['storage']) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      // Presigned upload links can't carry a checksum the browser doesn't know in advance.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  /** Local only: creates the bucket if it's missing. */
  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      if (statusOf(error) !== 404) throw error;
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      } catch (createError) {
        // Another process created it at the same moment.
        if (!(createError instanceof BucketAlreadyOwnedByYou)) throw createError;
      }
    }
  }

  async uploadUrl(key: string, options: { contentType: string; size: number; seconds: number }) {
    // The declared length is signed, so storage refuses a body of any other size.
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: options.contentType,
      ContentLength: options.size,
    });
    const url = await getSignedUrl(this.client, command, { expiresIn: options.seconds });
    return { url, headers: { 'content-type': options.contentType } };
  }

  async inspect(key: string, maxBytes: number) {
    let object;
    try {
      object = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (error) {
      if (error instanceof NoSuchKey || statusOf(error) === 404) return 'missing';
      throw error;
    }
    const body = object.Body as Readable;
    const hash = createHash('sha256');
    let size = 0;
    for await (const chunk of body) {
      size += (chunk as Buffer).length;
      if (size > maxBytes) {
        body.destroy();
        return 'too_large';
      }
      hash.update(chunk as Buffer);
    }
    return { size, sha256: hash.digest('hex'), etag: object.ETag ?? '' };
  }

  async promote(stagingKey: string, finalKey: string, etag: string, contentType: string) {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: finalKey,
        CopySource: `${this.bucket}/${stagingKey}`,
        CopySourceIfMatch: etag,
        MetadataDirective: 'REPLACE',
        ContentType: contentType,
      }),
    );
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: stagingKey }));
  }

  async write(key: string, bytes: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
      }),
    );
    return { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }

  async stream(key: string): Promise<Readable> {
    const object = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return object.Body as Readable;
  }

  async read(key: string): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of await this.stream(key)) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  async downloadUrl(key: string, fileName: string, seconds: number) {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    });
    return getSignedUrl(this.client, command, { expiresIn: seconds });
  }
}

/** True when a copy failed because the staged object changed after it was inspected. */
export const isChangedSinceInspected = (error: unknown) => statusOf(error) === 412;
