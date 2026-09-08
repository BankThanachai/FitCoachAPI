import { IsOptional, IsString } from 'class-validator';

export class UpdatePersonalLogExerciseDto {
  @IsOptional()
  @IsString()
  name?: string;
}
