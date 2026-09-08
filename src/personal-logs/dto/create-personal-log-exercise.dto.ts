import { Type } from 'class-transformer';
import { ArrayMinSize, IsString, ValidateNested } from 'class-validator';
import { CreatePersonalLogExerciseSetDto } from './create-personal-log-exercise-set.dto';

export class CreatePersonalLogExerciseDto {
  @IsString()
  name: string;

  @ValidateNested({ each: true })
  @Type(() => CreatePersonalLogExerciseSetDto)
  @ArrayMinSize(1)
  sets: CreatePersonalLogExerciseSetDto[];
}
