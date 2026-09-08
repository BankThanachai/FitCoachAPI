import { IsDateString, IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../shared/dto/pagination-query.dto';

export class FindClientWorkoutsDto extends PaginationQueryDto {
  /** Narrows to workouts booked against one specific CoursePurchase. */
  @IsOptional()
  @IsUUID()
  purchaseId?: string;

  /** Narrows to workouts on one exact calendar date (`YYYY-MM-DD`). */
  @IsOptional()
  @IsDateString()
  date?: string;

  /**
   * Narrows to workouts strictly after this calendar date (`YYYY-MM-DD`,
   * exclusive) — e.g. ClientHomeScreen passes today's date so its
   * "การซ้อมของวันต่อๆไป" list excludes today's own sessions, which its
   * separate hero card already shows.
   */
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  /**
   * Order by date: 'desc' (default, newest/furthest first) suits a workout
   * history view; 'asc' suits an upcoming-sessions view (soonest first),
   * e.g. ClientHomeScreen's "การซ้อมของวันต่อๆไป".
   */
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}
