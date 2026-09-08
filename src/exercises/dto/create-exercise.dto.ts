import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { CreateExerciseSetDto } from './create-exercise-set.dto';

export class CreateExerciseDto {
  @IsString()
  name: string;

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
