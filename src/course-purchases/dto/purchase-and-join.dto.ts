import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
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

  // Required when method === Card: the token Omise.js/the Flutter SDK
  // produced by tokenizing the card client-side. Never accept raw card
  // fields here — the backend must not see card numbers.
  @ValidateIf((dto: PurchaseAndJoinDto) => dto.method === PaymentMethod.Card)
  @IsString()
  omiseToken?: string;
}
