/**
 * Cloudflare R2 upload service using S3-compatible API
 */

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const R2_BUCKET = process.env.R2_BUCKET || '41rpm-screenshots';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://pub-d5db789b01364e288af930cfd54a666e.r2.dev';

const R2_ENDPOINT = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

/**
 * Upload a buffer to R2 and return the public URL.
 * Falls back to local filesystem if R2 is not configured.
 */
export async function uploadToR2(key: string, buf: Buffer, contentType = 'image/png'): Promise<string> {
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
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
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    });

    await client.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: buf,
      ContentType: contentType,
    }));

    return `${R2_PUBLIC_URL}/${key}`;
  } catch (err) {
    console.error('[R2] Upload failed:', err);
    return key; // Fallback to filename
  }
}
