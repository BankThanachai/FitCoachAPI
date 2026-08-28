import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateCouponDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsUUID()
  clientId: string;

  @IsNumber()
  @IsPositive()
  minHours: number;

  @IsDateString()
  expiresAt: string;
}
