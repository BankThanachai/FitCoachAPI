import { Injectable } from '@nestjs/common';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const PRESIGNED_URL_EXPIRY_SECONDS = 300;

@Injectable()
export class R2Service {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicUrl: string;

  constructor() {
    this.bucket = process.env.R2_BUCKET_NAME ?? '';
    this.publicUrl = process.env.R2_PUBLIC_URL ?? '';
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
      },
    });
  }

  /** Returns a short-lived URL the client can PUT the file body to directly. */
  async getUploadUrl(key: string, contentType: string) {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    return getSignedUrl(this.client, command, {
      expiresIn: PRESIGNED_URL_EXPIRY_SECONDS,
    });
  }

  getPublicUrl(key: string) {
    return `${this.publicUrl}/${key}`;
  }
}
