import { IsInt, IsNumber, IsOptional, Min } from 'class-validator';

export class CreatePersonalLogExerciseSetDto {
  @IsInt()
  @Min(1)
  order: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  weightKg?: number;

  @IsInt()
  @Min(0)
  reps: number;
}
