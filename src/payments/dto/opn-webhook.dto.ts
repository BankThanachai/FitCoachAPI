import { IsObject, IsOptional, IsString } from 'class-validator';

export class OpnWebhookDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  key: string;

  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}
