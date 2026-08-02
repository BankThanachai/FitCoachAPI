import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateCardioDto {
  @IsString()
  activity: string;

  @IsInt()
  @Min(0)
  durationMin: number;

  @IsInt()
  @Min(0)
  kcal: number;

  @IsInt()
  @Min(0)
  avgHeartRate: number;

  @IsString()
  location: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  distanceKm?: number;

  @IsOptional()
  @IsString()
  route?: string;

  @IsUUID()
  assignedToId: string;
}
