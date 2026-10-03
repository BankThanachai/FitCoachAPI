import { IsObject, IsOptional, IsString } from 'class-validator';

// Deliberately loose (see OpnWebhookDto): main.ts sets forbidNonWhitelisted
// globally, so any field RevenueCat adds that isn't listed here would be
// rejected with a 400 — and RevenueCat would retry that delivery on a
// backoff for hours. The event body is only ever used to find out WHICH user
// changed; the real state is re-fetched from RevenueCat.
export class RevenueCatWebhookDto {
  @IsOptional()
  @IsString()
  api_version?: string;

  @IsObject()
  event: Record<string, unknown>;
}
