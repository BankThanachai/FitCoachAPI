import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { PRO_PORTFOLIO_PHOTO_LIMIT } from '../../subscriptions/subscription.constants';
import { PresignUploadDto } from './presign-upload.dto';

export class PresignPortfolioPhotoDto extends PresignUploadDto {
  // Optional so existing clients keep working. When given, a slot the account
  // isn't allowed to use is rejected here, before the bytes go up to R2,
  // instead of only at confirm time.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(PRO_PORTFOLIO_PHOTO_LIMIT)
  order?: number;
}
