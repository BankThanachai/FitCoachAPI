import { IsOptional, IsString } from 'class-validator';

export class CancelWorkoutDto {
  /** Optional context for why this workout is being cancelled. */
  @IsOptional()
  @IsString()
  reason?: string;
}
