import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class CreateReviewDto {
  @IsUUID()
  targetUserId: string;

  @IsInt()
  @Min(0)
  @Max(5)
  score: number;

  @IsOptional()
  @IsString()
  comment?: string;
}
