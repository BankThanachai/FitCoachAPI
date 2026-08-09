import { IsOptional, Matches } from 'class-validator';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class CreateWorkingHourDto {
  @IsOptional()
  @Matches(TIME_PATTERN, { message: 'startTime must be in HH:mm format' })
  startTime?: string;

  @IsOptional()
  @Matches(TIME_PATTERN, { message: 'endTime must be in HH:mm format' })
  endTime?: string;
}
