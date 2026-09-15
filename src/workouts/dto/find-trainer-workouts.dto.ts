import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { WorkoutStatus } from '../../../generated/prisma/client';
import { PaginationQueryDto } from '../../shared/dto/pagination-query.dto';

export class FindTrainerWorkoutsDto extends PaginationQueryDto {
  /** Narrows to workouts on one exact calendar date (`YYYY-MM-DD`). */
  @IsOptional()
  @IsDateString()
  date?: string;

  /** Narrows to workouts currently in this status. */
  @IsOptional()
  @IsEnum(WorkoutStatus)
  status?: WorkoutStatus;

  /** Narrows to workouts on or after this calendar date (`YYYY-MM-DD`, inclusive). */
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  /** Narrows to workouts on or before this calendar date (`YYYY-MM-DD`, inclusive). */
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  /** Case-insensitive partial match against the client's first/last name. */
  @IsOptional()
  @IsString()
  clientName?: string;
}
