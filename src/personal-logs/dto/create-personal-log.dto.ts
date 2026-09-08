import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsDateString,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { CreatePersonalLogExerciseDto } from './create-personal-log-exercise.dto';

export class CreatePersonalLogDto {
  @IsDateString()
  date: string;

  @IsOptional()
  @IsString()
  note?: string;

  @ValidateNested({ each: true })
  @Type(() => CreatePersonalLogExerciseDto)
  @ArrayMinSize(1)
  exercises: CreatePersonalLogExerciseDto[];
}
