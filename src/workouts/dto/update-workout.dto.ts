import { IsDateString, IsEnum, IsOptional, Matches } from 'class-validator';
import { WorkoutStatus } from '../../../generated/prisma/client';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class UpdateWorkoutDto {
  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @Matches(TIME_PATTERN, { message: 'fromTime must be in HH:mm format' })
  fromTime?: string;

  @IsOptional()
  @Matches(TIME_PATTERN, { message: 'toTime must be in HH:mm format' })
  toTime?: string;

  @IsOptional()
  @IsEnum(WorkoutStatus)
  status?: WorkoutStatus;
}
