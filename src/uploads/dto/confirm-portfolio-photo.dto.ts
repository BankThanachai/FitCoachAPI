import { IsInt, IsString, Max, Min } from 'class-validator';
import { PRO_PORTFOLIO_PHOTO_LIMIT } from '../../subscriptions/subscription.constants';

export class ConfirmPortfolioPhotoDto {
  @IsString()
  key: string;

  // Up to the Pro ceiling here; a free account asking for a slot above its
  // own limit is turned away by UploadsService with 403 PRO_REQUIRED.
  @IsInt()
  @Min(1)
  @Max(PRO_PORTFOLIO_PHOTO_LIMIT)
  order: number;
}
