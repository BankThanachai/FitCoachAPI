import { IsInt, IsNumber, Min } from 'class-validator';

export class CreateExerciseSetDto {
  @IsInt()
  @Min(1)
  order: number;

  @IsNumber()
  @Min(0)
  weightKg: number;

  @IsInt()
  @Min(0)
  reps: number;
}
