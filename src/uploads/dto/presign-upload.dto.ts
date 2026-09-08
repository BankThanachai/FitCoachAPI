import { IsIn } from 'class-validator';

const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export class PresignUploadDto {
  @IsIn(ALLOWED_CONTENT_TYPES)
  contentType: string;
}
