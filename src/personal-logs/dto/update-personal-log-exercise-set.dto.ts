import { PartialType } from '@nestjs/mapped-types';
import { CreatePersonalLogExerciseSetDto } from './create-personal-log-exercise-set.dto';

export class UpdatePersonalLogExerciseSetDto extends PartialType(
  CreatePersonalLogExerciseSetDto,
) {}
