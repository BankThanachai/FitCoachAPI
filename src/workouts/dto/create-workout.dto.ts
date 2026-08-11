import { IsDateString, IsUUID, Matches } from 'class-validator';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class CreateWorkoutDto {
  @IsUUID()
  trainerId: string;

  @IsUUID()
  clientId: string;

  @IsDateString()
  date: string;

  @Matches(TIME_PATTERN, { message: 'fromTime must be in HH:mm format' })
  fromTime: string;

  @Matches(TIME_PATTERN, { message: 'toTime must be in HH:mm format' })
  toTime: string;
}
