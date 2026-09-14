import { IsNotEmpty, IsString } from 'class-validator';

export class RejectWorkoutDto {
  /** Why the booking or submission is being declined — shown to the other party. */
  @IsString()
  @IsNotEmpty()
  reason: string;
}
