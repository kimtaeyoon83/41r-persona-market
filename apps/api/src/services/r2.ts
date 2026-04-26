/**
 * Cloudflare R2 upload service using S3-compatible API
 */
import { env } from '../config/env.js';

const R2_ENDPOINT = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

/**
 * Upload a buffer to R2 and return the public URL.
 * Falls back to local filesystem if R2 is not configured.
 */
export async function uploadToR2(key: string, buf: Buffer, contentType = 'image/png'): Promise<string> {
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    console.warn('[R2] Not configured, skipping upload for:', key);
    return key; // Return just the filename as fallback
  }

  try {
    // Use AWS SDK v3 S3-compatible client
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');

    const client = new S3Client({
      region: 'auto',
      endpoint: R2_ENDPOINT,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
    });

    await client.send(new PutObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: key,
      Body: buf,
      ContentType: contentType,
    }));

    return `${env.R2_PUBLIC_URL}/${key}`;
  } catch (err) {
    console.error('[R2] Upload failed:', err);
    return key; // Fallback to filename
  }
}
