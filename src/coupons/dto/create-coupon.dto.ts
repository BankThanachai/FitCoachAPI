import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsPositive,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateCouponDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsUUID()
  clientId: string;

  @IsInt()
  @IsPositive()
  minSessions: number;

  @IsInt()
  @IsPositive()
  bonusSessions: number;

  @IsDateString()
  expiresAt: string;
}
