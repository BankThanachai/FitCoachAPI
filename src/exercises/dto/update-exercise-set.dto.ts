import { PartialType } from '@nestjs/mapped-types';
import { CreateExerciseSetDto } from './create-exercise-set.dto';

export class UpdateExerciseSetDto extends PartialType(CreateExerciseSetDto) {}
