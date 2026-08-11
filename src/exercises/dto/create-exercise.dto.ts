import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { MuscleGroup } from '../../../generated/prisma/client';
import { CreateExerciseSetDto } from './create-exercise-set.dto';

export class CreateExerciseDto {
  @IsString()
  name: string;

  @IsEnum(MuscleGroup)
  muscleGroup: MuscleGroup;

  @IsOptional()
  @IsString()
  note?: string;

  @IsUUID()
  assignedToId: string;

  @IsUUID()
  workoutId: string;

  @ValidateNested({ each: true })
  @Type(() => CreateExerciseSetDto)
  @ArrayMinSize(1)
  sets: CreateExerciseSetDto[];
}
