import { Transform } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';
import { WorkoutStatus } from '../../../generated/prisma/client';
import { PaginationQueryDto } from '../../shared/dto/pagination-query.dto';

/**
 * Normalises the `status` query into a flat array of trimmed strings.
 * Accepts a comma-separated list (`status=A,B`), repeated params
 * (`status=A&status=B`, which Express hands us as an array), a single value,
 * or any mix of those. Empty segments are kept so they fail enum validation
 * with a 400 rather than silently widening the filter.
 */
function toStatusList({ value }: { value: unknown }): unknown {
  if (value === undefined || value === null) return value;
  const parts: unknown[] = Array.isArray(value) ? value : [value];
  return parts
    .flatMap((part): unknown[] =>
      typeof part === 'string' ? part.split(',') : [part],
    )
    .map((part) => (typeof part === 'string' ? part.trim() : part));
}

export class FindTrainerWorkoutsDto extends PaginationQueryDto {
  /** Narrows to workouts on one exact calendar date (`YYYY-MM-DD`). */
  @IsOptional()
  @IsDateString()
  date?: string;

  /**
   * Narrows to workouts currently in any of these statuses — omit for every
   * status. Accepts a single value (`status=PendingApproval`), a
   * comma-separated list (`status=PendingApproval,TrainerApproved`), or
   * repeated params (`status=PendingApproval&status=TrainerApproved`).
   */
  @IsOptional()
  @Transform(toStatusList)
  @IsArray()
  @IsEnum(WorkoutStatus, { each: true })
  status?: WorkoutStatus[];

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
