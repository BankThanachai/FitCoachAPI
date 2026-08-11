import { IsDateString } from 'class-validator';

export class GetAvailabilityDto {
  @IsDateString()
  date: string;
}
