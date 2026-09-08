import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { ActivityStatus } from '../../../generated/prisma/client';

export class UpdateExerciseDto {
  @IsOptional()
  @IsString()
  name?: string;

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
