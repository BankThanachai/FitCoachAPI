import { Matches } from 'class-validator';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export class GetAvailabilityMonthDto {
  @Matches(MONTH_PATTERN, { message: 'month must be in YYYY-MM format' })
  month: string;
}
