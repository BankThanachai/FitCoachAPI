import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { PaymentMethod } from '../../../generated/prisma/client';

export class PurchaseAndJoinDto {
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  couponIds?: string[];

  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  @IsNumber()
  @Min(0)
  amount: number;

  @IsOptional()
  @IsString()
  opnChargeId?: string;

  @IsOptional()
  @IsString()
  opnSourceId?: string;
}
