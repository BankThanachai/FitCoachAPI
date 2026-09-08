import { IsInt, IsString, Max, Min } from 'class-validator';

export class ConfirmPortfolioPhotoDto {
  @IsString()
  key: string;

  @IsInt()
  @Min(1)
  @Max(5)
  order: number;
}
