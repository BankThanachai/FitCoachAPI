import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { ActivityStatus, MuscleGroup } from '../../../generated/prisma/client';

export class UpdateExerciseDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(MuscleGroup)
  muscleGroup?: MuscleGroup;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsUUID()
  assignedToId?: string;

  @IsOptional()
  @IsEnum(ActivityStatus)
  status?: ActivityStatus;
}
